import { rolldown } from 'rolldown';
import { expect, test } from 'vitest';

test('jsx false should report error', async () => {
  try {
    const build = await rolldown({
      input: './main.jsx',
      cwd: import.meta.dirname,
      transform: {
        jsx: false,
      },
    });
    await build.write({});
  } catch (e: any) {
    expect(e.message).toContain('PARSE_ERROR');
  }
});
