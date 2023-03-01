import { verbose, Database } from 'sqlite3';
import fs from 'fs';
const sqlite = verbose();

const commentsTable = 'comments';
const postsTable = 'posts';
const messagesTable = 'messages';
const registrationsTable = 'registrations';

type StorageInfoGetter = (id: number) => Promise<StorageInfo>;
type RowUpserter = (
  id: number,
  minutesUntilReprocess?: number
) => Promise<void>;

type DatabaseFunctions = {
  getPostStorageInfo: StorageInfoGetter;
  getCommentStorageInfo: StorageInfoGetter;
  getMessageStorageInfo: StorageInfoGetter;
  getRegistrationStorageInfo: StorageInfoGetter;
  upsertPost: RowUpserter;
  upsertComment: RowUpserter;
  upsertMessage: RowUpserter;
  upsertRegistration: RowUpserter;
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

const getPostRow = async (db: Database, id: number) =>
  await getRow(db, id, postsTable);

const getCommentRow = async (db: Database, id: number) =>
  await getRow(db, id, commentsTable);

const getMessageRow = async (db: Database, id: number) =>
  await getRow(db, id, messagesTable);

const getRegistrationRow = async (db: Database, id: number) =>
  await getRow(db, id, registrationsTable);

const upsertPostRow = async (
  db: Database,
  id: number,
  minutesUntilReprocess?: number
) => await upsert(db, id, postsTable, minutesUntilReprocess);

const upsertCommentRow = async (
  db: Database,
  id: number,
  minutesUntilReprocess?: number
) => await upsert(db, id, commentsTable, minutesUntilReprocess);

const upsertMessageRow = async (
  db: Database,
  id: number,
  minutesUntilReprocess?: number
) => await upsert(db, id, messagesTable, minutesUntilReprocess);

const upsertRegistrationRow = async (
  db: Database,
  id: number,
  minutesUntilReprocess?: number
) => await upsert(db, id, registrationsTable, minutesUntilReprocess);

const useDatabase = async (doStuffWithDB: (db: Database) => Promise<void>) => {
  const db = new sqlite.Database('./db.sqlite3');

  await doStuffWithDB(db);

  db.close();
};

export const useDatabaseFunctions = async (
  doStuff: (funcs: DatabaseFunctions) => Promise<void>
) => {
  await useDatabase(async (db) => {
    const getPostStorageInfo = async (id: number) => await getPostRow(db, id);
    const getCommentStorageInfo = async (id: number) =>
      await getCommentRow(db, id);
    const getMessageStorageInfo = async (id: number) =>
      await getMessageRow(db, id);
    const getRegistrationStorageInfo = async (id: number) =>
      await getRegistrationRow(db, id);

    const upsertPost = async (id: number, minutesUntilReprocess?: number) =>
      await upsertPostRow(db, id, minutesUntilReprocess);
    const upsertComment = async (id: number, minutesUntilReprocess?: number) =>
      await upsertCommentRow(db, id, minutesUntilReprocess);
    const upsertMessage = async (id: number, minutesUntilReprocess?: number) =>
      await upsertMessageRow(db, id, minutesUntilReprocess);
    const upsertRegistration = async (
      id: number,
      minutesUntilReprocess?: number
    ) => await upsertRegistrationRow(db, id, minutesUntilReprocess);

    await doStuff({
      getCommentStorageInfo,
      getMessageStorageInfo,
      getPostStorageInfo,
      upsertComment,
      upsertMessage,
      upsertPost,
      getRegistrationStorageInfo,
      upsertRegistration
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
      createTable(db, postsTable);
      createTable(db, commentsTable);
      createTable(db, messagesTable);
      createTable(db, registrationsTable);
    });
  });
};
