export type IdKind = "recipe" | "ingredient";

export interface IdRecord {
  kind: IdKind;
  line: number;
  name: string;
}

export interface RegisterSuccess {
  ok: true;
}

export interface RegisterFailure {
  ok: false;
  reason: "empty" | "duplicate";
  existing?: IdRecord;
}

export type RegisterResult = RegisterSuccess | RegisterFailure;

export interface IdRegistry {
  register(id: string, record: IdRecord): RegisterResult;
  has(id: string): boolean;
  entries(): IterableIterator<[string, IdRecord]>;
}

export const createIdRegistry = (): IdRegistry => {
  const state = new Map<string, IdRecord>();

  return {
    register(id, record) {
      if (id.trim().length === 0) {
        return { ok: false, reason: "empty" };
      }

      const existing = state.get(id);
      if (existing) {
        return { ok: false, reason: "duplicate", existing };
      }

      state.set(id, record);
      return { ok: true };
    },
    has(id: string) {
      if (id.trim().length === 0) {
        return false;
      }
      return state.has(id);
    },
    entries() {
      return state.entries();
    },
  };
};
