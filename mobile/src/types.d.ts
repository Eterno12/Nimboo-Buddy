declare module 'sql.js/dist/sql-wasm-browser.js' {
  import type { SqlJsModule } from '../db/sqlJsDatabase';
  const init: (config?: { locateFile?: (file: string) => string }) => Promise<SqlJsModule>;
  export default init;
}
