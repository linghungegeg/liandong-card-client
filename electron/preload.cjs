const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "snapshot",
  "records",
  "sessionCheck",
  "addAccount",
  "login",
  "openOfficial",
  "sync",
  "categories",
  "publish",
  "uploadImage",
  "chooseFile",
  "previewFile",
  "importCards",
  "addCards",
  "saveRule",
  "toggleRule",
  "reconcile",
  "reconcilePublish",
  "cardList",
];
contextBridge.exposeInMainWorld(
  "liandong",
  Object.fromEntries(
    methods.map((name) => [
      name,
      async (data = {}) => {
        const r = await ipcRenderer.invoke("client:" + name, data);
        if (!r.ok) throw new Error(r.error);
        return r.data;
      },
    ]),
  ),
);
