import path from 'path';

export const withReactScanTreeShake = ({ ...config }: any) => {
  return function (api: { cache: (_: boolean) => void }) {
    api.cache(true);

    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      if (!config.plugins) {
        config.plugins = [];
      }

      const transformerPath = path.join(__dirname, './transformer.js');
      config.plugins.push(transformerPath);

      if (!config.presets) {
        config.preset = [];
      }

      const hasBabelPresetExp = config.presets.some(
        (preset) => preset === 'babel-preset-expo',
      );
      if (!hasBabelPresetExp) {
        config.preset.push('babel-preset-expo');
      }
    }

    return {
      ...config,
      presets: config.presets ?? [],
      plugins: config.plugins,
    };
  };
};
