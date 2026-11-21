// The only bridge between the sandboxed window and the app: a fixed, allowlisted
// API. No remote content, no arbitrary channel or method names reach ipcRenderer
// from the renderer.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
    getState: 'ep:get-state',
    refreshSetup: 'ep:refresh-setup',
    saveLogin: 'ep:save-login',
    forgetLogin: 'ep:forget-login',
    startSession: 'ep:start-session',
    completeWizard: 'ep:complete-wizard',
    action: 'ep:action',
    reflectionRespond: 'ep:reflection-respond',
    checkUpdate: 'ep:check-update',
    applyUpdate: 'ep:apply-update',
    uninstall: 'ep:uninstall',
};
const EVENTS = {
    state: 'ep:state',
    reflectionRequest: 'ep:reflection-request',
    reflectionSettled: 'ep:reflection-settled',
    maintenanceProgress: 'ep:maintenance-progress',
};

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const listen = channel => fn => ipcRenderer.on(channel, (event, payload) => fn(payload));

contextBridge.exposeInMainWorld('educationPerfected', {
    getState: () => invoke(CHANNELS.getState),
    refreshSetup: () => invoke(CHANNELS.refreshSetup),
    saveLogin: (email, password) => invoke(CHANNELS.saveLogin, email, password),
    forgetLogin: () => invoke(CHANNELS.forgetLogin),
    startSession: () => invoke(CHANNELS.startSession),
    completeWizard: () => invoke(CHANNELS.completeWizard),
    action: (name, value) => invoke(CHANNELS.action, name, value),
    respondReflection: (id, text) => invoke(CHANNELS.reflectionRespond, id, text),
    checkUpdate: () => invoke(CHANNELS.checkUpdate),
    applyUpdate: () => invoke(CHANNELS.applyUpdate),
    uninstall: choices => invoke(CHANNELS.uninstall, choices),
    onState: listen(EVENTS.state),
    onReflectionRequest: listen(EVENTS.reflectionRequest),
    onReflectionSettled: listen(EVENTS.reflectionSettled),
    onMaintenanceProgress: listen(EVENTS.maintenanceProgress),
});
