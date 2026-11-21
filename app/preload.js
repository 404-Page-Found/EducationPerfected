// The only bridge between the sandboxed window and the app: a fixed, allowlisted
// API. No remote content, no arbitrary channel or method names reach ipcRenderer
// from the renderer.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
    getState: 'ep:get-state',
    refreshSetup: 'ep:refresh-setup',
    downloadBrowser: 'ep:download-browser',
    saveLogin: 'ep:save-login',
    forgetLogin: 'ep:forget-login',
    startSession: 'ep:start-session',
    completeWizard: 'ep:complete-wizard',
    action: 'ep:action',
    reflectionRespond: 'ep:reflection-respond',
};
const EVENTS = {
    state: 'ep:state',
    setupProgress: 'ep:setup-progress',
    reflectionRequest: 'ep:reflection-request',
    reflectionSettled: 'ep:reflection-settled',
};

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const listen = channel => fn => ipcRenderer.on(channel, (event, payload) => fn(payload));

contextBridge.exposeInMainWorld('educationPerfected', {
    getState: () => invoke(CHANNELS.getState),
    refreshSetup: () => invoke(CHANNELS.refreshSetup),
    downloadBrowser: () => invoke(CHANNELS.downloadBrowser),
    saveLogin: (email, password) => invoke(CHANNELS.saveLogin, email, password),
    forgetLogin: () => invoke(CHANNELS.forgetLogin),
    startSession: () => invoke(CHANNELS.startSession),
    completeWizard: () => invoke(CHANNELS.completeWizard),
    action: (name, value) => invoke(CHANNELS.action, name, value),
    respondReflection: (id, text) => invoke(CHANNELS.reflectionRespond, id, text),
    onState: listen(EVENTS.state),
    onSetupProgress: listen(EVENTS.setupProgress),
    onReflectionRequest: listen(EVENTS.reflectionRequest),
    onReflectionSettled: listen(EVENTS.reflectionSettled),
});
