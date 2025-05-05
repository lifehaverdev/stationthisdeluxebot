import { terser } from 'rollup-plugin-terser';
import css from 'rollup-plugin-css-only';

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/bundle.js',
    format: 'iife',
    sourcemap: true
  },
  plugins: [
    css({ output: 'bundle.css' }),
    terser()
  ]
}; 