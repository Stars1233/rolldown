import type { BindingOutputAsset, ExternalMemoryStatus } from '../binding.cjs';
import { getLazyFields, lazy } from '../decorators/lazy';
import { nonEnumerable } from '../decorators/non-enumerable';
import type { AssetSource } from '../utils/asset-source';
import { transformAssetSource } from '../utils/asset-source';
import type { OutputAsset } from './rolldown-output';

export class OutputAssetImpl implements OutputAsset {
  readonly type = 'asset' as const;

  constructor(private bindingAsset: BindingOutputAsset) {
  }

  @lazy
  get fileName(): string {
    return this.bindingAsset.fileName;
  }

  @lazy
  get originalFileName(): string | null {
    return this.bindingAsset.originalFileName || null;
  }

  @lazy
  get originalFileNames(): string[] {
    return this.bindingAsset.originalFileNames;
  }

  @lazy
  get name(): string | undefined {
    return this.bindingAsset.name ?? undefined;
  }

  @lazy
  get names(): string[] {
    return this.bindingAsset.names;
  }

  @lazy
  get source(): AssetSource {
    return transformAssetSource(this.bindingAsset.source);
  }

  @nonEnumerable
  __rolldown_external_memory_handle__(
    keepDataAlive?: boolean,
  ): ExternalMemoryStatus {
    if (keepDataAlive) {
      this.#evaluateAllLazyFields();
    }
    return this.bindingAsset.dropInner();
  }

  #evaluateAllLazyFields(): void {
    for (const field of getLazyFields(this)) {
      // Accessing the property triggers lazy evaluation via the @lazy decorator.
      const _value = (this as any)[field];
    }
  }
}
