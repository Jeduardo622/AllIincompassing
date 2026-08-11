import { harnessGoalDomains } from "../harness-data";

type HarnessQueryResult<T> = Promise<{ data: T; error: null }>;
const rejectWrite = (): never => {
  throw new Error("responsive_harness_read_only");
};

const resolveRows = (table: string) => {
  if (table === "goal_domains") {
    return harnessGoalDomains;
  }

  return [];
};

const createQueryBuilder = (table: string) => {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    neq() {
      return builder;
    },
    order(): HarnessQueryResult<unknown[]> {
      return Promise.resolve({ data: resolveRows(table), error: null });
    },
    single(): HarnessQueryResult<unknown | null> {
      const rows = resolveRows(table);
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    insert() {
      return rejectWrite();
    },
    update() {
      return rejectWrite();
    },
    delete() {
      return rejectWrite();
    },
    upsert() {
      return rejectWrite();
    },
  };

  return builder;
};

export const supabase = {
  from(table: string) {
    return createQueryBuilder(table);
  },
  storage: {
    from() {
      return {
        upload: async () => rejectWrite(),
        remove: async () => rejectWrite(),
      };
    },
  },
};
