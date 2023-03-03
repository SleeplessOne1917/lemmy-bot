import { verbose, Database } from 'sqlite3';
import fs from 'fs';
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
  'lockedPosts'
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
      (err, row) => {
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
        $reprocessTime: minutesUntilReprocess
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

const useDatabase = async (doStuffWithDB: (db: Database) => Promise<void>) => {
  const db = new sqlite.Database('./db.sqlite3');

  await doStuffWithDB(db);

  db.close();
};

export const useDatabaseFunctions = async (
  table: TableType,
  doStuff: (funcs: DatabaseFunctions) => Promise<void>
) => {
  await useDatabase(async (db) => {
    const { get, upsert } = tableFuncMap.get(table)!;

    await doStuff({
      get: (id: number) => get(db, id),
      upsert: (id: number, minutesUntilReprocess?: number) =>
        upsert(db, id, minutesUntilReprocess)
    });
  });
};

const createTable = (db: Database, table: string) => {
  db.run(
    `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, reprocessTime INTEGER) WITHOUT ROWID;`
  );

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_id ON ${table} (id);`);
};

export const setupDB = async () => {
  if (!fs.existsSync('./db.sqlite3')) {
    console.log('Creating database file');

    fs.writeFile('./db.sqlite3', '', (err) => {
      if (err) {
        console.log('Database error: ' + err.message);
        process.exit(1);
      }
    });
  }

  await useDatabase(async (db) => {
    db.serialize(() => {
      console.log('Initializing DB');
      for (const table of tableTypes) {
        createTable(db, table);
      }
    });
  });
};
