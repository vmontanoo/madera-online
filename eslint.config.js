import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'public/**/*', 'server/**/*', 'test/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
