import Store from "electron-store";

interface StoreSchema {
  windowBounds: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  };
  settings: {
    fontSize: number;
  };
}

export const store = new Store<StoreSchema>({
  defaults: {
    windowBounds: {
      width: 1200,
      height: 800,
    },
    settings: {
      fontSize: 14,
    },
  },
});
