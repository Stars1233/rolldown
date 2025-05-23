import type { Program } from '@oxc-project/types';
import type { BindingPluginContext, ParserOptions } from '../binding';
import { SYMBOL_FOR_RESOLVE_CALLER_THAT_SKIP_SELF } from '../constants/plugin-context';
import { LOG_LEVEL_WARN } from '../log/logging';
import { logCycleLoading } from '../log/logs';
import type { OutputOptions } from '../options/output-options';
import { parseAst } from '../parse-ast-index';
import {
  type MinimalPluginContext,
  MinimalPluginContextImpl,
} from '../plugin/minimal-plugin-context';
import type { Extends, TypeAssert } from '../types/assert';
import type { LogHandler, LogLevelOption } from '../types/misc';
import type { ModuleInfo } from '../types/module-info';
import type { PartialNull } from '../types/utils';
import { type AssetSource, bindingAssetSource } from '../utils/asset-source';
import { unimplemented, unreachable } from '../utils/misc';
import { bindingifySideEffects } from '../utils/transform-side-effects';
import type {
  CustomPluginOptions,
  ModuleOptions,
  Plugin,
  ResolvedId,
} from './index';
import { PluginContextData } from './plugin-context-data';

export interface EmittedAsset {
  type: 'asset';
  name?: string;
  fileName?: string;
  originalFileName?: string | null;
  source: AssetSource;
}

export interface EmittedChunk {
  type: 'chunk';
  name?: string;
  fileName?: string;
  id: string;
  importer?: string;
}

export type EmittedFile = EmittedAsset | EmittedChunk;

export interface PluginContextResolveOptions {
  skipSelf?: boolean;
  custom?: CustomPluginOptions;
}

export interface PrivatePluginContextResolveOptions
  extends PluginContextResolveOptions
{
  [SYMBOL_FOR_RESOLVE_CALLER_THAT_SKIP_SELF]?: symbol;
}

export type GetModuleInfo = (moduleId: string) => ModuleInfo | null;

export interface PluginContext extends MinimalPluginContext {
  emitFile(file: EmittedFile): string;
  getFileName(referenceId: string): string;
  getModuleIds(): IterableIterator<string>;
  getModuleInfo: GetModuleInfo;
  addWatchFile(id: string): void;
  load(
    options:
      & { id: string; resolveDependencies?: boolean }
      & Partial<
        PartialNull<ModuleOptions>
      >,
  ): Promise<ModuleInfo>;
  parse(input: string, options?: ParserOptions | undefined | null): Program;
  resolve(
    source: string,
    importer?: string,
    options?: PluginContextResolveOptions,
  ): Promise<ResolvedId | null>;
}

export class PluginContextImpl extends MinimalPluginContextImpl {
  getModuleInfo: GetModuleInfo;
  constructor(
    private outputOptions: OutputOptions,
    private context: BindingPluginContext,
    plugin: Plugin,
    private data: PluginContextData,
    private onLog: LogHandler,
    logLevel: LogLevelOption,
    watchMode: boolean,
    private currentLoadingModule?: string,
  ) {
    super(onLog, logLevel, plugin.name!, watchMode);
    this.getModuleInfo = (id: string) => this.data.getModuleInfo(id, context);
  }

  public async load(
    options:
      & { id: string; resolveDependencies?: boolean }
      & Partial<
        PartialNull<ModuleOptions>
      >,
  ): Promise<ModuleInfo> {
    const id = options.id;
    if (id === this.currentLoadingModule) {
      this.onLog(
        LOG_LEVEL_WARN,
        logCycleLoading(this.pluginName, this.currentLoadingModule),
      );
    }
    // resolveDependencies always true at rolldown
    const moduleInfo = this.data.getModuleInfo(id, this.context);
    if (moduleInfo && moduleInfo.code !== null /* module already parsed */) {
      return moduleInfo;
    }
    const rawOptions: ModuleOptions = {
      meta: options.meta || {},
      moduleSideEffects: options.moduleSideEffects || null,
      invalidate: false,
    };
    this.data.updateModuleOption(id, rawOptions);

    async function createLoadModulePromise(
      context: BindingPluginContext,
      data: PluginContextData,
    ) {
      const loadPromise = data.loadModulePromiseMap.get(id);
      if (loadPromise) {
        return loadPromise;
      }
      let resolveFn;
      // TODO: If is not resolved, we need to set a time to avoid waiting.
      const promise = new Promise<void>((resolve, _) => {
        resolveFn = resolve;
      });
      data.loadModulePromiseMap.set(id, promise);
      try {
        await context.load(
          id,
          bindingifySideEffects(options.moduleSideEffects),
          (_success) => {
            // Here the bundler will give an error for it, so here avoid give other error again, it could be is confusing.
            // TODO: It maybe could be improved in the future.
            resolveFn!();
          },
        );
      } catch (e) {
        // If the load module has failed, avoid it re-load using unresolved promise.
        data.loadModulePromiseMap.delete(id);
        throw e;
      }
      return promise;
    }

    // Here using one promise to avoid pass more callback to rust side, it only accept one callback, other will be ignored.
    await createLoadModulePromise(this.context, this.data);
    return this.data.getModuleInfo(id, this.context)!;
  }

  public async resolve(
    source: string,
    importer?: string,
    options?: PluginContextResolveOptions,
  ): Promise<ResolvedId | null> {
    let receipt: number | undefined = undefined;
    if (options != null) {
      receipt = this.data.saveResolveOptions(options);
    }
    const res = await this.context.resolve(source, importer, {
      custom: receipt,
      skipSelf: options?.skipSelf,
    });
    if (receipt != null) {
      this.data.removeSavedResolveOptions(receipt);
    }

    if (res == null) return null;
    const info = this.data.getModuleOption(res.id) || ({} as ModuleOptions);
    return {
      ...res,
      external: res.external === 'relative'
        ? unreachable(
          `The PluginContext resolve result external couldn't be 'relative'`,
        )
        : res.external,
      ...info,
    };
  }

  public emitFile: PluginContext['emitFile'] = (file): string => {
    // @ts-expect-error
    if (file.type === 'prebuilt-chunk') {
      return unimplemented('PluginContext.emitFile with type prebuilt-chunk');
    }
    if (file.type === 'chunk') {
      return this.context.emitChunk(file);
    }
    const fnSanitizedFileName =
      file.fileName || typeof this.outputOptions.sanitizeFileName !== 'function'
        ? undefined
        : this.outputOptions.sanitizeFileName!(file.name || 'asset');
    const filename = file.fileName ? undefined : this.getAssetFileNames(file);
    return this.context.emitFile(
      {
        ...file,
        originalFileName: file.originalFileName || undefined,
        source: bindingAssetSource(file.source),
      },
      filename,
      fnSanitizedFileName,
    );
  };

  private getAssetFileNames(file: EmittedAsset): string | undefined {
    if (typeof this.outputOptions.assetFileNames === 'function') {
      return this.outputOptions.assetFileNames({
        names: file.name ? [file.name] : [],
        originalFileNames: file.originalFileName ? [file.originalFileName] : [],
        source: file.source,
        type: 'asset',
      });
    }
  }

  public getFileName(referenceId: string): string {
    return this.context.getFileName(referenceId);
  }

  public getModuleIds(): IterableIterator<string> {
    return this.data.getModuleIds(this.context);
  }

  public addWatchFile(id: string): void {
    this.context.addWatchFile(id);
  }

  public parse(
    input: string,
    options?: ParserOptions | undefined | null,
  ): Program {
    return parseAst(input, options);
  }
}

function _assert() {
  // adding implements to class disallows extending PluginContext by declaration merging
  // instead check that PluginContextImpl is assignable to PluginContext here
  type _ = TypeAssert<Extends<PluginContextImpl, PluginContext>>;
}
