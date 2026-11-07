/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gd: {
          blue: '#1a73e8',
          blueSoft: '#c2e7ff',
          blueDark: '#001d35',
          bg: '#f8fafd',
          surface: '#ffffff',
          hover: '#f1f3f4',
          text: '#1f1f1f',
          muted: '#444746'
        }
      },
      fontFamily: {
        sans: [
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'system-ui',
          'sans-serif'
        ]
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.15)'
      }
    }
  },
  plugins: []
}
