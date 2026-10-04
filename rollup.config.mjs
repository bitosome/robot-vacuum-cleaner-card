import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';

// The built bundle is emitted into dist/ and published as a GitHub release
// asset, matching the other bitosome cards (HACS resolves it by `filename`).
export default {
  input: 'src/robot-vacuum-cleaner-card.ts',
  output: {
    file: 'dist/robot-vacuum-cleaner-card.js',
    format: 'es',
    inlineDynamicImports: true,
    sourcemap: false,
  },
  plugins: [
    resolve(),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json' }),
    terser(),
  ],
};
