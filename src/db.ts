import { verbose, Database } from 'sqlite3';
import fs from 'fs';
const sqlite = verbose();

type DatabaseFunctions = {
  repliedToPost: (id: number) => Promise<boolean>;
  repliedToComment: (id: number) => Promise<boolean>;
  addPostResponse: (id: number) => Promise<void>;
  addCommentResponse: (id: number) => Promise<void>;
  reportedPost: (id: number) => Promise<boolean>;
  reportedComment: (id: number) => Promise<boolean>;
  addPostReport: (id: number) => Promise<void>;
  addCommentReport: (id: number) => Promise<void>;
};

const getExists = (db: Database, id: number, table: string) => {
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
    db.run(`INSERT OR IGNORE INTO ${table} VALUES (?);`, [id], (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const getRepliedToPost = async (db: Database, id: number) =>
  await getExists(db, id, 'responded_posts');

const getRepliedToComment = async (db: Database, id: number) =>
  await getExists(db, id, 'responded_comments');

const insertRespondedPostId = async (db: Database, id: number) =>
  await insertId(db, id, 'responded_posts');

const insertRespondedCommentId = async (db: Database, id: number) =>
  await insertId(db, id, 'responded_comments');

const getReportedComment = async (db: Database, id: number) =>
  await getExists(db, id, 'reported_comments');

const getReportedPost = async (db: Database, id: number) =>
  await getExists(db, id, 'reported_posts');

const insertReportedCommentId = async (db: Database, id: number) =>
  await insertId(db, id, 'reported_comments');

const insertReportedPostId = async (db: Database, id: number) =>
  await insertId(db, id, 'reported_posts');

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
    const addPostResponse = async (id: number) =>
      await insertRespondedPostId(db, id);
    const addCommentResponse = async (id: number) =>
      await insertRespondedCommentId(db, id);
    const reportedPost = async (id: number) => await getReportedPost(db, id);
    const reportedComment = async (id: number) =>
      await getReportedComment(db, id);
    const addPostReport = async (id: number) =>
      await insertReportedPostId(db, id);
    const addCommentReport = async (id: number) =>
      await insertReportedCommentId(db, id);

    await doStuff({
      repliedToComment,
      repliedToPost,
      addCommentResponse,
      addPostResponse,
      reportedComment,
      reportedPost,
      addCommentReport,
      addPostReport,
    });
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
        'CREATE TABLE IF NOT EXISTS responded_comments (id INTEGER PRIMARY KEY) WITHOUT ROWID;'
      );
      db.run(
        'CREATE TABLE IF NOT EXISTS responded_posts (id INTEGER PRIMARY KEY) WITHOUT ROWID;'
      );

      db.run(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_responded_comment_id ON responded_comments (id);'
      );
      db.run(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_responded_post_id ON responded_posts (id);'
      );

      db.run(
        'CREATE TABLE IF NOT EXISTS reported_comments (id INTEGER PRIMARY KEY) WITHOUT ROWID;'
      );
      db.run(
        'CREATE TABLE IF NOT EXISTS reported_posts (id INTEGER PRIMARY KEY) WITHOUT ROWID;'
      );

      db.run(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_reported_comment_id ON reported_comments (id);'
      );
      db.run(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_reported_post_id ON reported_posts (id);'
      );
    });
  });
};
