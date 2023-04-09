import { verbose, Database } from 'sqlite3';
import { existsSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
const sqlite = verbose();

const tableTypes = [
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

type TableType = (typeof tableTypes)[number];

export type StorageInfoGetter = (id: number) => Promise<StorageInfo>;
export type RowUpserter = (
  id: number,
  minutesUntilReprocess?: number
) => Promise<void>;

type DatabaseFunctions = {
  get: StorageInfoGetter;
  upsert: RowUpserter;
};

export type StorageInfo = {
  exists: boolean;
  reprocessTime: Date | null;
};

const getRow = (db: Database, id: number, table: string) =>
  new Promise<StorageInfo>((resolve, reject) => {
    db.get(
      `SELECT id, reprocessTime FROM ${table} WHERE id=?;`,
      id,
      (err, row: { reprocessTime: number }) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            exists: !!row,
            reprocessTime:
              row && row.reprocessTime ? new Date(row.reprocessTime) : null
          });
        }
      }
    );
  });

const upsert = (
  db: Database,
  id: number,
  table: string,
  minutesUntilReprocess?: number
) =>
  new Promise<void>((resolve, reject) => {
    db.run(
      `INSERT INTO ${table} (id, reprocessTime) VALUES ($id, $reprocessTime) ON CONFLICT (id) DO UPDATE SET reprocessTime=$reprocessTime;`,
      {
        $id: id,
        $reprocessTime:
          minutesUntilReprocess && minutesUntilReprocess > 0
            ? Date.now() + 1000 * 60 * minutesUntilReprocess
            : null
      },
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });

const tableFuncMap = new Map(
  tableTypes.map((tt) => [
    tt,
    {
      get: async (db: Database, id: number) => await getRow(db, id, tt),
      upsert: async (
        db: Database,
        id: number,
        minutesUntilReprocess?: number
      ) => await upsert(db, id, tt, minutesUntilReprocess)
    }
  ])
);

let memoryDb: Database | undefined = undefined;

const useDatabase = async (
  doStuffWithDB: (db: Database) => Promise<void>,
  dbPath?: string
) => {
  let db: Database;

  if (!dbPath) {
    if (memoryDb) {
      db = memoryDb;
    } else {
      memoryDb = new Database(':memory:');
      db = memoryDb;
    }
  } else {
    db = new sqlite.Database(dbPath);
  }

  await doStuffWithDB(db);

  if (dbPath) {
    db.close();
  }
};

export const useDatabaseFunctions = async (
  table: TableType,
  doStuff: (funcs: DatabaseFunctions) => Promise<void>,
  dbPath?: string
) => {
  await useDatabase(async (db) => {
    const { get, upsert } = tableFuncMap.get(table)!;

    await doStuff({
      get: (id: number) => get(db, id),
      upsert: (id: number, minutesUntilReprocess?: number) =>
        upsert(db, id, minutesUntilReprocess)
    });
  }, dbPath);
};

const createTable = (db: Database, table: string) => {
  db.run(
    `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, reprocessTime INTEGER) WITHOUT ROWID;`
  );

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_id ON ${table} (id);`);
};

export const setupDB = async (dbPath?: string) => {
  if (dbPath && !existsSync(dbPath)) {
    console.log('Creating database file');

    try {
      await mkdir(path.dirname(dbPath), { recursive: true });
      await writeFile(dbPath, '');
    } catch (error) {
      console.log('Error making database file: ' + error);

      process.exit(1);
    }
  }

  await useDatabase(async (db) => {
    db.serialize(() => {
      console.log('Initializing DB');
      for (const table of tableTypes) {
        createTable(db, table);
      }
    });
  }, dbPath);
};
