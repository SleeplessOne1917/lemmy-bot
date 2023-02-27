import { verbose, Database } from 'sqlite3';
import fs from 'fs';
const sqlite = verbose();

type DatabaseFunctions = {
  repliedToPost: (id: number) => Promise<boolean>;
  repliedToComment: (id: number) => Promise<boolean>;
  addPost: (id: number) => Promise<void>;
  addComment: (id: number) => Promise<void>;
};

const getReplied = (db: Database, id: number, table: string) => {
  return new Promise<boolean>((resolve, reject) => {
    db.get(`SELECT * FROM ${table} WHERE id = ?;`, [id], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(!!row);
      }
    });
  });
};

const insertId = (db: Database, id: number, table: string) => {
  return new Promise<void>((resolve, reject) => {
    db.run(`INSERT INTO ${table} VALUES (?);`, [id], (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const getRepliedToPost = async (db: Database, id: number) =>
  await getReplied(db, id, 'posts');

const getRepliedToComment = async (db: Database, id: number) =>
  await getReplied(db, id, 'comments');

const insertPostId = async (db: Database, id: number) =>
  await insertId(db, id, 'posts');

const insertCommentId = async (db: Database, ids: number) =>
  await insertId(db, ids, 'comments');

const useDatabase = async (doStuffWithDB: (db: Database) => Promise<void>) => {
  const db = new sqlite.Database('./db.sqlite3');

  await doStuffWithDB(db);

  db.close();
};

export const useDatabaseFunctions = async (
  doStuff: (funcs: DatabaseFunctions) => Promise<void>
) => {
  await useDatabase(async (db) => {
    const repliedToPost = async (id: number) => await getRepliedToPost(db, id);
    const repliedToComment = async (id: number) =>
      await getRepliedToComment(db, id);
    const addPost = async (id: number) => await insertPostId(db, id);
    const addComment = async (id: number) => await insertCommentId(db, id);

    await doStuff({ repliedToComment, repliedToPost, addComment, addPost });
  });
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
      db.run(
        'CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY) WITHOUT ROWID;'
      );
      db.run(
        'CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY) WITHOUT ROWID;'
      );

      db.run(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_id ON comments (id);'
      );
      db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_post_id ON posts (id);');
    });
  });
};
