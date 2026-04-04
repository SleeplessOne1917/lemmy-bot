import type { Database } from 'better-sqlite3';

const TABLE_TYPES = [
  'comments',
  'posts',
  'messages',
  'registrations',
  'mentions',
  'replies',
  'comments',
  'commentReports',
  'postReports',
  'messageReports',
  'removedPosts',
  'lockedPosts',
  'featuredPosts',
  'removedComments',
  'removedCommunities',
  'communityBans',
  'modsAddedToCommunities',
  'modsTransferredToCommunities',
  'adminsAdded',
  'siteBans'
] as const;

type TableType = (typeof TABLE_TYPES)[number];
type TableEntry = { id: number; reprocessTime: number };

export type StorageInfoGetter = (id: number) => StorageInfo;
export type RowUpserter = (id: number, minutesUntilReprocess?: number) => void;

type DatabaseFunctions = {
  get: StorageInfoGetter;
  upsert: RowUpserter;
};

export type StorageInfo = {
  exists: boolean;
  reprocessTime: Date | null;
};

type TableFunctions = Readonly<{
  [k in TableType]: {
    get(db: Database, id: number): StorageInfo;
    upsert(db: Database, id: number, minutesUntilReprocess?: number): void;
  };
}>;

const TABLE_FUNCTIONS = TABLE_TYPES.reduce(
  (acc, tt) => ({
    ...acc,
    [tt]: {
      get: (db: Database, id: number) => getRow(db, id, tt),
      upsert: (db: Database, id: number, minutesUntilReprocess?: number) =>
        upsertRow(db, id, tt, minutesUntilReprocess)
    }
  }),
  {}
) as TableFunctions;

function getRow(db: Database, id: number, table: TableType): StorageInfo {
  const statement = db.prepare(
    `SELECT id, reprocessTime FROM ${table} WHERE id=?;`
  );
  const row = statement.get(id) as TableEntry | undefined;

  return {
    exists: !!row,
    reprocessTime: row?.reprocessTime ? new Date(row.reprocessTime) : null
  };
}

function upsertRow(
  db: Database,
  id: number,
  table: TableType,
  minutesUntilReprocess?: number
) {
  const statement = db.prepare(
    `INSERT INTO ${table} (id, reprocessTime) VALUES ($id, $reprocessTime) ON CONFLICT (id) DO UPDATE SET reprocessTime=$reprocessTime;`
  );

  statement.run({
    id,
    reprocessTime:
      minutesUntilReprocess && minutesUntilReprocess > 0
        ? Date.now() + 1000 * 60 * minutesUntilReprocess
        : null
  });
}

async function useDatabase(
  doStuffWithDB: (db: Database) => Promise<void>,
  dbPath?: string
) {
  let Database: typeof import('better-sqlite3');

  try {
    const { default: dbConstructor } = await import('better-sqlite3');
    Database = dbConstructor;
  } catch {
    console.warn(
      'better-sqlite3 optional dependency is not available. This can cause your bot to respond to the same event more than once (e.g. replying multiple times to the same post). If you have intentionally chosen to omit the use of sqlite, ignore this message.'
    );

    return;
  }

  // Empty string fallback creates a temporary database
  // See docs for more detail: https://github.com/WiseLibs/better-sqlite3/blob/HEAD/docs/api.md#new-databasepath-options
  const db = new Database(dbPath ?? '');
  db.pragma('journal_mode = WAL');

  try {
    await doStuffWithDB(db);
  } finally {
    db.close();
  }
}

export const useDatabaseFunctions = (
  table: TableType,
  doStuff: (funcs: DatabaseFunctions) => Promise<void>,
  dbPath?: string
) =>
  useDatabase(async (db) => {
    const { get, upsert } = TABLE_FUNCTIONS[table];

    await doStuff({
      get: (id: number) => get(db, id),
      upsert: (id: number, minutesUntilReprocess?: number) =>
        upsert(db, id, minutesUntilReprocess)
    });
  }, dbPath);

const createTable = (db: Database, table: string) => {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, reprocessTime INTEGER) WITHOUT ROWID;`
  ).run();

  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_id ON ${table} (id);`
  ).run();
};

export const setupDB = async (
  log: (output: string) => void,
  dbPath?: string
) => {
  await useDatabase(async (db) => {
    log('Initializing DB');
    for (const table of TABLE_TYPES) {
      createTable(db, table);
    }
  }, dbPath);
};
