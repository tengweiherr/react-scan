import { reactComponentNamePlugin } from '../index';

export const transform = async (code: string) => {
  const plugin = reactComponentNamePlugin.vite({}) as any;
  const transformFn: (...params: any[]) => any = plugin.transform;
  if (!transformFn) return code;

  const result = await transformFn.call(
    {
      getCombinedSourcemap: () => null,
      error: console.error,
    },
    code,
    'test.tsx',
  );

  if (!result) return code;
  if (typeof result === 'string') return result;
  return result.code;
};
