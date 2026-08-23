export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
};

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
};

export type D1Result<T = unknown> = {
  results: T[];
  success: boolean;
  meta: {
    served_by: string;
    duration: number;
    changes: number;
    last_row_id: number;
    rows_read: number;
    rows_written: number;
  };
};

export type D1ExecResult = {
  count: number;
  duration: number;
};

export type Clock = {
  nowSeconds(): number;
};

export type IdGenerator = {
  uuid(): string;
};

export const defaultClock: Clock = {
  nowSeconds() {
    return Math.floor(Date.now() / 1000);
  },
};

export const defaultIdGenerator: IdGenerator = {
  uuid() {
    return crypto.randomUUID();
  },
};
