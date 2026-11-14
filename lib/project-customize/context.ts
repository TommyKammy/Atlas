import type { Dispatch, SetStateAction } from "react";

/** Drawer-wide feedback and permissions shared by independent feature editors. */
export type CustomizeContext = {
  projectId: number;
  canConfigure: boolean;
  canEdit: boolean;
  canAdmin: boolean;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  notify: (message: string) => void;
  refresh: () => void;
};
