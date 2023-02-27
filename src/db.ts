import { verbose, Database } from 'sqlite3';
import fs from 'fs';
import { Vote } from './helpers';
const sqlite = verbose();

const commentsTable = 'comments';
const postsTable = 'posts';

type DatabaseFunctions = {
  getPostStoredData: (id: number) => Promise<StoredData>;
  getCommentStoredData: (id: number) => Promise<StoredData>;
  addPostResponse: (id: number) => Promise<void>;
  addCommentResponse: (id: number) => Promise<void>;
  addPostReport: (id: number) => Promise<void>;
  addCommentReport: (id: number) => Promise<void>;
  setPostVote: (id: number, vote: Vote) => Promise<void>;
  setCommentVote: (id: number, vote: Vote) => Promise<void>;
};

export type StoredData = {
  alreadyResponded: boolean;
  alreadyReported: boolean;
  myVote: Vote;
};

const getRow = (db: Database, id: number, table: string) =>
  new Promise<StoredData>((resolve, reject) => {
    db.get(
      `SELECT responded AS alreadyResponded, reported AS alreadyReported, vote AS myVote FROM ${table} WHERE id=?;`,
      id,
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(
            row ??
              ({
                alreadyReported: false,
                alreadyResponded: false,
                myVote: Vote.Neutral
              } as StoredData)
          );
        }
      }
    );
  });

const upsertResponded = (db: Database, id: number, table: string) =>
  new Promise<void>((resolve, reject) => {
    db.run(
      `INSERT INTO ${table} (id, responded, reported, vote) VALUES (?, TRUE, FALSE, 0) ON CONFLICT (id) DO UPDATE SET responded=TRUE;`,
      id,
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });

const upsertReported = (db: Database, id: number, table: string) =>
  new Promise<void>((resolve, reject) => {
    db.run(
      `INSERT INTO ${table} (id, responded, reported, vote) VALUES (?, FALSE, TRUE, 0) ON CONFLICT (id) DO UPDATE SET reported=TRUE;`,
      id,
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });

const upsertVote = (db: Database, id: number, table: string, vote: Vote) =>
  new Promise<void>((resolve, reject) => {
    db.run(
      `INSERT INTO ${table} (id, responded, reported, vote) VALUES ($id, FALSE, FALSE, $vote) ON CONFLICT (id) DO UPDATE SET vote = $vote;`,
      { $id: id, $vote: vote },
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

const upsertRespondedPostId = async (db: Database, id: number) =>
  await upsertResponded(db, id, postsTable);

const upsertRespondedCommentId = async (db: Database, id: number) =>
  await upsertResponded(db, id, commentsTable);

const upsertReportedCommentId = async (db: Database, id: number) =>
  await upsertReported(db, id, commentsTable);

const upsertReportedPostId = async (db: Database, id: number) =>
  await upsertReported(db, id, postsTable);

const upsertVotePost = async (db: Database, id: number, vote: Vote) =>
  await upsertVote(db, id, postsTable, vote);

const upsertVoteComment = async (db: Database, id: number, vote: Vote) =>
  await upsertVote(db, id, commentsTable, vote);

const useDatabase = async (doStuffWithDB: (db: Database) => Promise<void>) => {
  const db = new sqlite.Database('./db.sqlite3');

  await doStuffWithDB(db);

  db.close();
};

export const useDatabaseFunctions = async (
  doStuff: (funcs: DatabaseFunctions) => Promise<void>
) => {
  await useDatabase(async (db) => {
    const getPostStoredData = async (id: number) => await getPostRow(db, id);
    const getCommentStoredData = async (id: number) =>
      await getCommentRow(db, id);
    const addPostResponse = async (id: number) =>
      await upsertRespondedPostId(db, id);
    const addCommentResponse = async (id: number) =>
      await upsertRespondedCommentId(db, id);
    const addPostReport = async (id: number) =>
      await upsertReportedPostId(db, id);
    const addCommentReport = async (id: number) =>
      await upsertReportedCommentId(db, id);
    const setPostVote = async (id: number, vote: Vote) =>
      await upsertVotePost(db, id, vote);
    const setCommentVote = async (id: number, vote: Vote) =>
      await upsertVoteComment(db, id, vote);

    await doStuff({
      addCommentResponse,
      addPostResponse,
      addCommentReport,
      addPostReport,
      getCommentStoredData,
      getPostStoredData,
      setPostVote,
      setCommentVote
    });
  });
};

const createTable = (db: Database, table: string) => {
  db.run(
    `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, responded INTEGER, reported INTEGER, vote INTEGER) WITHOUT ROWID;`
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
    });
  });
};
