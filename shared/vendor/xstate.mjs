// xstate, bundled and downlevelled to ES5 by scripts/vendor.mjs.
// Hand edits are lost on the next run. Hermes cannot parse ES6 class syntax and
// nothing in the plugin client pipeline lowers it, so the package cannot be
// imported directly. See scripts/vendor.mjs for the whole story.
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
// node_modules/.pnpm/xstate@5.33.2/node_modules/xstate/dist/xstate-dev.esm.js
function getGlobal() {
    if (typeof globalThis !== "undefined") {
        return globalThis;
    }
    if (typeof self !== "undefined") {
        return self;
    }
    if (typeof window !== "undefined") {
        return window;
    }
    if (typeof global !== "undefined") {
        return global;
    }
}
function getDevTools() {
    var w = getGlobal();
    if (w.__xstate__) {
        return w.__xstate__;
    }
    return void 0;
}
var devToolsAdapter = function (service) {
    if (typeof window === "undefined") {
        return;
    }
    var devTools = getDevTools();
    if (devTools) {
        devTools.register(service);
    }
};
// node_modules/.pnpm/xstate@5.33.2/node_modules/xstate/dist/raise-97446fd4.esm.js
var Mailbox = /** @class */ (function () {
    function Mailbox(_process) {
        this._process = _process;
        this._active = false;
        this._current = null;
        this._last = null;
    }
    Mailbox.prototype.start = function () {
        this._active = true;
        this.flush();
    };
    Mailbox.prototype.clear = function () {
        if (this._current) {
            this._current.next = null;
            this._last = this._current;
        }
    };
    Mailbox.prototype.enqueue = function (event) {
        var enqueued = {
            value: event,
            next: null
        };
        if (this._current) {
            this._last.next = enqueued;
            this._last = enqueued;
            return;
        }
        this._current = enqueued;
        this._last = enqueued;
        if (this._active) {
            this.flush();
        }
    };
    Mailbox.prototype.flush = function () {
        while (this._current) {
            var consumed = this._current;
            this._process(consumed.value);
            this._current = consumed.next;
        }
        this._last = null;
    };
    return Mailbox;
}());
var STATE_DELIMITER = ".";
var TARGETLESS_KEY = "";
var NULL_EVENT = "";
var STATE_IDENTIFIER = "#";
var WILDCARD = "*";
var XSTATE_INIT = "xstate.init";
var XSTATE_ERROR = "xstate.error";
var XSTATE_STOP = "xstate.stop";
function createAfterEvent(delayRef, id) {
    return {
        type: "xstate.after.".concat(delayRef, ".").concat(id)
    };
}
function createDoneStateEvent(id, output) {
    return {
        type: "xstate.done.state.".concat(id),
        output: output
    };
}
function createDoneActorEvent(invokeId, output) {
    return {
        type: "xstate.done.actor.".concat(invokeId),
        output: output,
        actorId: invokeId
    };
}
function createErrorActorEvent(id, error) {
    return {
        type: "xstate.error.actor.".concat(id),
        error: error,
        actorId: id
    };
}
function createInitEvent(input) {
    return {
        type: XSTATE_INIT,
        input: input
    };
}
function reportUnhandledError(err) {
    setTimeout(function () {
        throw err;
    });
}
var symbolObservable = (function () { return typeof Symbol === "function" && Symbol.observable || "@@observable"; })();
function matchesState(parentStateId, childStateId) {
    var parentStateValue = toStateValue(parentStateId);
    var childStateValue = toStateValue(childStateId);
    if (typeof childStateValue === "string") {
        if (typeof parentStateValue === "string") {
            return childStateValue === parentStateValue;
        }
        return false;
    }
    if (typeof parentStateValue === "string") {
        return parentStateValue in childStateValue;
    }
    return Object.keys(parentStateValue).every(function (key) {
        if (!(key in childStateValue)) {
            return false;
        }
        return matchesState(parentStateValue[key], childStateValue[key]);
    });
}
function toStatePath(stateId) {
    if (isArray(stateId)) {
        return stateId;
    }
    var result = [];
    var segment = "";
    for (var i = 0; i < stateId.length; i++) {
        var char = stateId.charCodeAt(i);
        switch (char) {
            // \
            case 92:
                segment += stateId[i + 1];
                i++;
                continue;
            // .
            case 46:
                result.push(segment);
                segment = "";
                continue;
        }
        segment += stateId[i];
    }
    result.push(segment);
    return result;
}
function toStateValue(stateValue) {
    if (isMachineSnapshot(stateValue)) {
        return stateValue.value;
    }
    if (typeof stateValue !== "string") {
        return stateValue;
    }
    var statePath = toStatePath(stateValue);
    return pathToStateValue(statePath);
}
function pathToStateValue(statePath) {
    if (statePath.length === 1) {
        return statePath[0];
    }
    var value = {};
    var marker = value;
    for (var i = 0; i < statePath.length - 1; i++) {
        if (i === statePath.length - 2) {
            marker[statePath[i]] = statePath[i + 1];
        }
        else {
            var previous = marker;
            marker = {};
            previous[statePath[i]] = marker;
        }
    }
    return value;
}
function mapValues(collection, iteratee) {
    var result = {};
    var collectionKeys = Object.keys(collection);
    for (var i = 0; i < collectionKeys.length; i++) {
        var key = collectionKeys[i];
        result[key] = iteratee(collection[key], key, collection, i);
    }
    return result;
}
function toArrayStrict(value) {
    if (isArray(value)) {
        return value;
    }
    return [value];
}
function toArray(value) {
    if (value === void 0) {
        return [];
    }
    return toArrayStrict(value);
}
function resolveOutput(mapper, context, event, self2) {
    if (typeof mapper === "function") {
        return mapper({
            context: context,
            event: event,
            self: self2
        });
    }
    return mapper;
}
function isArray(value) {
    return Array.isArray(value);
}
function isErrorActorEvent(event) {
    return event.type.startsWith("xstate.error.actor");
}
function toTransitionConfigArray(configLike) {
    return toArrayStrict(configLike).map(function (transitionLike) {
        if (typeof transitionLike === "undefined" || typeof transitionLike === "string") {
            return {
                target: transitionLike
            };
        }
        return transitionLike;
    });
}
function normalizeTarget(target) {
    if (target === void 0 || target === TARGETLESS_KEY) {
        return void 0;
    }
    return toArray(target);
}
function toObserver(nextHandler, errorHandler, completionHandler) {
    var _a, _b, _c;
    var isObserver = typeof nextHandler === "object";
    var self2 = isObserver ? nextHandler : void 0;
    return {
        next: (_a = (isObserver ? nextHandler.next : nextHandler)) === null || _a === void 0 ? void 0 : _a.bind(self2),
        error: (_b = (isObserver ? nextHandler.error : errorHandler)) === null || _b === void 0 ? void 0 : _b.bind(self2),
        complete: (_c = (isObserver ? nextHandler.complete : completionHandler)) === null || _c === void 0 ? void 0 : _c.bind(self2)
    };
}
function createInvokeId(stateNodeId, index) {
    return "".concat(index, ".").concat(stateNodeId);
}
function resolveReferencedActor(machine, src) {
    var match = src.match(/^xstate\.invoke\.(\d+)\.(.*)/);
    if (!match) {
        return machine.implementations.actors[src];
    }
    var _a = __read(match, 3), indexStr = _a[1], nodeId = _a[2];
    var node = machine.getStateNodeById(nodeId);
    var invokeConfig = node.config.invoke;
    return (Array.isArray(invokeConfig) ? invokeConfig[indexStr] : invokeConfig).src;
}
function getAllOwnEventDescriptors(snapshot) {
    return __spreadArray([], __read(/* @__PURE__ */ new Set(__spreadArray([], __read(snapshot._nodes.flatMap(function (sn) { return sn.ownEvents; })), false))), false);
}
function matchesEventDescriptor(eventType, descriptor) {
    if (descriptor === eventType) {
        return true;
    }
    if (descriptor === WILDCARD) {
        return true;
    }
    if (!descriptor.endsWith(".*")) {
        return false;
    }
    var partialEventTokens = descriptor.split(".");
    var eventTokens = eventType.split(".");
    for (var tokenIndex = 0; tokenIndex < partialEventTokens.length; tokenIndex++) {
        var partialEventToken = partialEventTokens[tokenIndex];
        var eventToken = eventTokens[tokenIndex];
        if (partialEventToken === "*") {
            var isLastToken = tokenIndex === partialEventTokens.length - 1;
            return isLastToken;
        }
        if (partialEventToken !== eventToken) {
            return false;
        }
    }
    return true;
}
function createScheduledEventId(actorRef, id) {
    return "".concat(actorRef.sessionId, ".").concat(id);
}
var idCounter = 0;
function createSystem(rootActor, options) {
    var _a;
    var children = /* @__PURE__ */ new Map();
    var keyedActors = /* @__PURE__ */ new Map();
    var reverseKeyedActors = /* @__PURE__ */ new WeakMap();
    var inspectionObservers = /* @__PURE__ */ new Set();
    var timerMap = {};
    var clock = options.clock, logger = options.logger;
    var scheduler = {
        schedule: function (source, target, event, delay, id) {
            if (id === void 0) { id = Math.random().toString(36).slice(2); }
            var scheduledEvent = {
                source: source,
                target: target,
                event: event,
                delay: delay,
                id: id,
                startedAt: Date.now()
            };
            var scheduledEventId = createScheduledEventId(source, id);
            system._snapshot._scheduledEvents[scheduledEventId] = scheduledEvent;
            var timeout = clock.setTimeout(function () {
                delete timerMap[scheduledEventId];
                delete system._snapshot._scheduledEvents[scheduledEventId];
                system._relay(source, target, event);
            }, delay);
            timerMap[scheduledEventId] = timeout;
        },
        cancel: function (source, id) {
            var scheduledEventId = createScheduledEventId(source, id);
            var timeout = timerMap[scheduledEventId];
            delete timerMap[scheduledEventId];
            delete system._snapshot._scheduledEvents[scheduledEventId];
            if (timeout !== void 0) {
                clock.clearTimeout(timeout);
            }
        },
        cancelAll: function (actorRef) {
            for (var scheduledEventId in system._snapshot._scheduledEvents) {
                var scheduledEvent = system._snapshot._scheduledEvents[scheduledEventId];
                if (scheduledEvent.source === actorRef) {
                    scheduler.cancel(actorRef, scheduledEvent.id);
                }
            }
        }
    };
    var sendInspectionEvent = function (event) {
        if (!inspectionObservers.size) {
            return;
        }
        var resolvedInspectionEvent = __assign(__assign({}, event), { rootId: rootActor.sessionId });
        inspectionObservers.forEach(function (observer) { var _a; return (_a = observer.next) === null || _a === void 0 ? void 0 : _a.call(observer, resolvedInspectionEvent); });
    };
    var system = {
        _snapshot: {
            _scheduledEvents: (_a = ((options === null || options === void 0 ? void 0 : options.snapshot) && options.snapshot.scheduler)) !== null && _a !== void 0 ? _a : {}
        },
        _bookId: function () { return "x:".concat(idCounter++); },
        _register: function (sessionId, actorRef) {
            children.set(sessionId, actorRef);
            return sessionId;
        },
        _unregister: function (actorRef) {
            children.delete(actorRef.sessionId);
            var systemId = reverseKeyedActors.get(actorRef);
            if (systemId !== void 0) {
                keyedActors.delete(systemId);
                reverseKeyedActors.delete(actorRef);
            }
        },
        get: function (systemId) {
            return keyedActors.get(systemId);
        },
        getAll: function () {
            return Object.fromEntries(keyedActors.entries());
        },
        _set: function (systemId, actorRef) {
            var existing = keyedActors.get(systemId);
            if (existing && existing !== actorRef) {
                throw new Error("Actor with system ID '".concat(systemId, "' already exists."));
            }
            keyedActors.set(systemId, actorRef);
            reverseKeyedActors.set(actorRef, systemId);
        },
        inspect: function (observerOrFn) {
            var observer = toObserver(observerOrFn);
            inspectionObservers.add(observer);
            return {
                unsubscribe: function () {
                    inspectionObservers.delete(observer);
                }
            };
        },
        _sendInspectionEvent: sendInspectionEvent,
        _relay: function (source, target, event) {
            system._sendInspectionEvent({
                type: "@xstate.event",
                sourceRef: source,
                actorRef: target,
                event: event
            });
            target._send(event);
        },
        scheduler: scheduler,
        getSnapshot: function () {
            return {
                _scheduledEvents: __assign({}, system._snapshot._scheduledEvents)
            };
        },
        start: function () {
            var scheduledEvents = system._snapshot._scheduledEvents;
            system._snapshot._scheduledEvents = {};
            for (var scheduledId in scheduledEvents) {
                var _a = scheduledEvents[scheduledId], source = _a.source, target = _a.target, event_1 = _a.event, delay = _a.delay, id = _a.id;
                scheduler.schedule(source, target, event_1, delay, id);
            }
        },
        _clock: clock,
        _logger: logger
    };
    return system;
}
var executingCustomAction = false;
var $$ACTOR_TYPE = 1;
var ProcessingStatus = /* @__PURE__ */ (function (ProcessingStatus2) {
    ProcessingStatus2[ProcessingStatus2["NotStarted"] = 0] = "NotStarted";
    ProcessingStatus2[ProcessingStatus2["Running"] = 1] = "Running";
    ProcessingStatus2[ProcessingStatus2["Stopped"] = 2] = "Stopped";
    return ProcessingStatus2;
})({});
var defaultOptions = {
    clock: {
        setTimeout: function (fn, ms) {
            return setTimeout(fn, ms);
        },
        clearTimeout: function (id) {
            return clearTimeout(id);
        }
    },
    logger: console.log.bind(console),
    devTools: false
};
var Actor = /** @class */ (function () {
    /**
     * Creates a new actor instance for the given logic with the provided options,
     * if any.
     *
     * @param logic The logic to create an actor from
     * @param options Actor options
     */
    function class_1(logic, options) {
        var _this = this;
        var _a, _b, _c, _d;
        this.logic = logic;
        this._snapshot = void 0;
        this.clock = void 0;
        this.options = void 0;
        this.id = void 0;
        this.mailbox = new Mailbox(this._process.bind(this));
        this.observers = /* @__PURE__ */ new Set();
        this.eventListeners = /* @__PURE__ */ new Map();
        this.logger = void 0;
        this._processingStatus = ProcessingStatus.NotStarted;
        this._parent = void 0;
        this._syncSnapshot = void 0;
        this.ref = void 0;
        this._actorScope = void 0;
        this.systemId = void 0;
        this.sessionId = void 0;
        this.system = void 0;
        this._doneEvent = void 0;
        this.src = void 0;
        this._deferred = [];
        var resolvedOptions = __assign(__assign({}, defaultOptions), options);
        var clock = resolvedOptions.clock, logger = resolvedOptions.logger, parent = resolvedOptions.parent, syncSnapshot = resolvedOptions.syncSnapshot, id = resolvedOptions.id, systemId = resolvedOptions.systemId, inspect = resolvedOptions.inspect;
        this.system = parent ? parent.system : createSystem(this, {
            clock: clock,
            logger: logger
        });
        if (inspect && !parent) {
            this.system.inspect(toObserver(inspect));
        }
        this.sessionId = this.system._bookId();
        this.id = id !== null && id !== void 0 ? id : this.sessionId;
        this.logger = (_a = options === null || options === void 0 ? void 0 : options.logger) !== null && _a !== void 0 ? _a : this.system._logger;
        this.clock = (_b = options === null || options === void 0 ? void 0 : options.clock) !== null && _b !== void 0 ? _b : this.system._clock;
        this._parent = parent;
        this._syncSnapshot = syncSnapshot;
        this.options = resolvedOptions;
        this.src = (_c = resolvedOptions.src) !== null && _c !== void 0 ? _c : logic;
        this.ref = this;
        this._actorScope = {
            self: this,
            id: this.id,
            sessionId: this.sessionId,
            logger: this.logger,
            defer: function (fn) {
                _this._deferred.push(fn);
            },
            system: this.system,
            stopChild: function (child) {
                if (child._parent !== _this) {
                    throw new Error("Cannot stop child actor ".concat(child.id, " of ").concat(_this.id, " because it is not a child"));
                }
                child._stop();
            },
            emit: function (emittedEvent) {
                var e_1, _a;
                var listeners = _this.eventListeners.get(emittedEvent.type);
                var wildcardListener = _this.eventListeners.get("*");
                if (!listeners && !wildcardListener) {
                    return;
                }
                var allListeners = __spreadArray(__spreadArray([], __read(listeners ? listeners.values() : []), false), __read(wildcardListener ? wildcardListener.values() : []), false);
                try {
                    for (var allListeners_1 = __values(allListeners), allListeners_1_1 = allListeners_1.next(); !allListeners_1_1.done; allListeners_1_1 = allListeners_1.next()) {
                        var handler = allListeners_1_1.value;
                        try {
                            handler(emittedEvent);
                        }
                        catch (err) {
                            reportUnhandledError(err);
                        }
                    }
                }
                catch (e_1_1) { e_1 = { error: e_1_1 }; }
                finally {
                    try {
                        if (allListeners_1_1 && !allListeners_1_1.done && (_a = allListeners_1.return)) _a.call(allListeners_1);
                    }
                    finally { if (e_1) throw e_1.error; }
                }
            },
            actionExecutor: function (action) {
                var exec = function () {
                    _this._actorScope.system._sendInspectionEvent({
                        type: "@xstate.action",
                        actorRef: _this,
                        action: {
                            type: action.type,
                            params: action.params
                        }
                    });
                    if (!action.exec) {
                        return;
                    }
                    var saveExecutingCustomAction = executingCustomAction;
                    try {
                        executingCustomAction = true;
                        action.exec(action.info, action.params);
                    }
                    finally {
                        executingCustomAction = saveExecutingCustomAction;
                    }
                };
                if (_this._processingStatus === ProcessingStatus.Running) {
                    exec();
                }
                else {
                    _this._deferred.push(exec);
                }
            }
        };
        this.send = this.send.bind(this);
        this.system._sendInspectionEvent({
            type: "@xstate.actor",
            actorRef: this
        });
        if (systemId) {
            this.systemId = systemId;
            this.system._set(systemId, this);
        }
        this._initState((_d = options === null || options === void 0 ? void 0 : options.snapshot) !== null && _d !== void 0 ? _d : options === null || options === void 0 ? void 0 : options.state);
        if (systemId && this._snapshot.status !== "active") {
            this.system._unregister(this);
        }
    }
    class_1.prototype._initState = function (persistedState) {
        var _a;
        try {
            this._snapshot = persistedState ? this.logic.restoreSnapshot ? this.logic.restoreSnapshot(persistedState, this._actorScope) : persistedState : this.logic.getInitialSnapshot(this._actorScope, (_a = this.options) === null || _a === void 0 ? void 0 : _a.input);
        }
        catch (err) {
            this._snapshot = {
                status: "error",
                output: void 0,
                error: err
            };
        }
    };
    class_1.prototype.update = function (snapshot, event) {
        var e_2, _a, e_3, _b;
        var _c, _d;
        this._snapshot = snapshot;
        var deferredFn;
        while (deferredFn = this._deferred.shift()) {
            try {
                deferredFn();
            }
            catch (err) {
                this._deferred.length = 0;
                this._snapshot = __assign(__assign({}, snapshot), { status: "error", error: err });
            }
        }
        switch (this._snapshot.status) {
            case "active":
                try {
                    for (var _e = __values(this.observers), _f = _e.next(); !_f.done; _f = _e.next()) {
                        var observer = _f.value;
                        try {
                            (_c = observer.next) === null || _c === void 0 ? void 0 : _c.call(observer, snapshot);
                        }
                        catch (err) {
                            reportUnhandledError(err);
                        }
                    }
                }
                catch (e_2_1) { e_2 = { error: e_2_1 }; }
                finally {
                    try {
                        if (_f && !_f.done && (_a = _e.return)) _a.call(_e);
                    }
                    finally { if (e_2) throw e_2.error; }
                }
                break;
            case "done":
                try {
                    for (var _g = __values(this.observers), _h = _g.next(); !_h.done; _h = _g.next()) {
                        var observer = _h.value;
                        try {
                            (_d = observer.next) === null || _d === void 0 ? void 0 : _d.call(observer, snapshot);
                        }
                        catch (err) {
                            reportUnhandledError(err);
                        }
                    }
                }
                catch (e_3_1) { e_3 = { error: e_3_1 }; }
                finally {
                    try {
                        if (_h && !_h.done && (_b = _g.return)) _b.call(_g);
                    }
                    finally { if (e_3) throw e_3.error; }
                }
                this._stopProcedure();
                this._complete();
                this._doneEvent = createDoneActorEvent(this.id, this._snapshot.output);
                if (this._parent) {
                    this.system._relay(this, this._parent, this._doneEvent);
                }
                break;
            case "error":
                this._error(this._snapshot.error);
                break;
        }
        this.system._sendInspectionEvent({
            type: "@xstate.snapshot",
            actorRef: this,
            event: event,
            snapshot: snapshot
        });
    };
    /**
     * Subscribe an observer to an actor’s snapshot values.
     *
     * @remarks
     * The observer will receive the actor’s snapshot value when it is emitted.
     * The observer can be:
     *
     * - A plain function that receives the latest snapshot, or
     * - An observer object whose `.next(snapshot)` method receives the latest
     *   snapshot
     *
     * @example
     *
     * ```ts
     * // Observer as a plain function
     * const subscription = actor.subscribe((snapshot) => {
     *   console.log(snapshot);
     * });
     * ```
     *
     * @example
     *
     * ```ts
     * // Observer as an object
     * const subscription = actor.subscribe({
     *   next(snapshot) {
     *     console.log(snapshot);
     *   },
     *   error(err) {
     *     // ...
     *   },
     *   complete() {
     *     // ...
     *   }
     * });
     * ```
     *
     * The return value of `actor.subscribe(observer)` is a subscription object
     * that has an `.unsubscribe()` method. You can call
     * `subscription.unsubscribe()` to unsubscribe the observer:
     *
     * @example
     *
     * ```ts
     * const subscription = actor.subscribe((snapshot) => {
     *   // ...
     * });
     *
     * // Unsubscribe the observer
     * subscription.unsubscribe();
     * ```
     *
     * When the actor is stopped, all of its observers will automatically be
     * unsubscribed.
     *
     * @param observer - Either a plain function that receives the latest
     *   snapshot, or an observer object whose `.next(snapshot)` method receives
     *   the latest snapshot
     */
    class_1.prototype.subscribe = function (nextListenerOrObserver, errorListener, completeListener) {
        var _this = this;
        var _a;
        var observer = toObserver(nextListenerOrObserver, errorListener, completeListener);
        if (this._processingStatus !== ProcessingStatus.Stopped) {
            this.observers.add(observer);
        }
        else {
            switch (this._snapshot.status) {
                case "done":
                    try {
                        (_a = observer.complete) === null || _a === void 0 ? void 0 : _a.call(observer);
                    }
                    catch (err) {
                        reportUnhandledError(err);
                    }
                    break;
                case "error": {
                    var err = this._snapshot.error;
                    if (!observer.error) {
                        reportUnhandledError(err);
                    }
                    else {
                        try {
                            observer.error(err);
                        }
                        catch (err2) {
                            reportUnhandledError(err2);
                        }
                    }
                    break;
                }
            }
        }
        return {
            unsubscribe: function () {
                _this.observers.delete(observer);
            }
        };
    };
    class_1.prototype.on = function (type, handler) {
        var listeners = this.eventListeners.get(type);
        if (!listeners) {
            listeners = /* @__PURE__ */ new Set();
            this.eventListeners.set(type, listeners);
        }
        var wrappedHandler = handler.bind(void 0);
        listeners.add(wrappedHandler);
        return {
            unsubscribe: function () {
                listeners.delete(wrappedHandler);
            }
        };
    };
    class_1.prototype.select = function (selector, equalityFn) {
        var _this = this;
        if (equalityFn === void 0) { equalityFn = Object.is; }
        return {
            subscribe: function (observerOrFn) {
                var observer = toObserver(observerOrFn);
                var snapshot = _this.getSnapshot();
                var previousSelected = selector(snapshot);
                return _this.subscribe(function (snapshot2) {
                    var _a;
                    var nextSelected = selector(snapshot2);
                    if (!equalityFn(previousSelected, nextSelected)) {
                        previousSelected = nextSelected;
                        (_a = observer.next) === null || _a === void 0 ? void 0 : _a.call(observer, nextSelected);
                    }
                });
            },
            get: function () { return selector(_this.getSnapshot()); }
        };
    };
    /** Starts the Actor from the initial state */
    class_1.prototype.start = function () {
        var _this = this;
        if (this._processingStatus === ProcessingStatus.Running) {
            return this;
        }
        if (this._syncSnapshot) {
            this.subscribe({
                next: function (snapshot) {
                    if (snapshot.status === "active") {
                        _this.system._relay(_this, _this._parent, {
                            type: "xstate.snapshot.".concat(_this.id),
                            snapshot: snapshot
                        });
                    }
                },
                error: function () {
                }
            });
        }
        this.system._register(this.sessionId, this);
        if (this.systemId) {
            this.system._set(this.systemId, this);
        }
        this._processingStatus = ProcessingStatus.Running;
        var initEvent = createInitEvent(this.options.input);
        this.system._sendInspectionEvent({
            type: "@xstate.event",
            sourceRef: this._parent,
            actorRef: this,
            event: initEvent
        });
        var status = this._snapshot.status;
        switch (status) {
            case "done":
                this.update(this._snapshot, initEvent);
                return this;
            case "error":
                this._error(this._snapshot.error);
                return this;
        }
        if (!this._parent) {
            this.system.start();
        }
        if (this.logic.start) {
            try {
                this.logic.start(this._snapshot, this._actorScope);
            }
            catch (err) {
                this._snapshot = __assign(__assign({}, this._snapshot), { status: "error", error: err });
                this._error(err);
                return this;
            }
        }
        this.update(this._snapshot, initEvent);
        if (this.options.devTools) {
            this.attachDevTools();
        }
        this.mailbox.start();
        return this;
    };
    class_1.prototype._process = function (event) {
        var nextState;
        var caughtError;
        try {
            nextState = this.logic.transition(this._snapshot, event, this._actorScope);
        }
        catch (err) {
            caughtError = {
                err: err
            };
        }
        if (caughtError) {
            var err = caughtError.err;
            this._snapshot = __assign(__assign({}, this._snapshot), { status: "error", error: err });
            this._error(err);
            return;
        }
        this.update(nextState, event);
        if (event.type === XSTATE_STOP) {
            this._stopProcedure();
            this._complete();
        }
    };
    class_1.prototype._stop = function () {
        if (this._processingStatus === ProcessingStatus.Stopped) {
            return this;
        }
        this.mailbox.clear();
        if (this._processingStatus === ProcessingStatus.NotStarted) {
            this._processingStatus = ProcessingStatus.Stopped;
            return this;
        }
        this.mailbox.enqueue({
            type: XSTATE_STOP
        });
        return this;
    };
    /** Stops the Actor and unsubscribe all listeners. */
    class_1.prototype.stop = function () {
        if (this._parent) {
            throw new Error("A non-root actor cannot be stopped directly.");
        }
        return this._stop();
    };
    class_1.prototype._complete = function () {
        var e_4, _a;
        var _b;
        try {
            for (var _c = __values(this.observers), _d = _c.next(); !_d.done; _d = _c.next()) {
                var observer = _d.value;
                try {
                    (_b = observer.complete) === null || _b === void 0 ? void 0 : _b.call(observer);
                }
                catch (err) {
                    reportUnhandledError(err);
                }
            }
        }
        catch (e_4_1) { e_4 = { error: e_4_1 }; }
        finally {
            try {
                if (_d && !_d.done && (_a = _c.return)) _a.call(_c);
            }
            finally { if (e_4) throw e_4.error; }
        }
        this.observers.clear();
        this.eventListeners.clear();
    };
    class_1.prototype._reportError = function (err) {
        var e_5, _a;
        if (!this.observers.size) {
            if (!this._parent) {
                reportUnhandledError(err);
            }
            this.eventListeners.clear();
            return;
        }
        var reportError = false;
        try {
            for (var _b = __values(this.observers), _c = _b.next(); !_c.done; _c = _b.next()) {
                var observer = _c.value;
                var errorListener = observer.error;
                reportError || (reportError = !errorListener);
                try {
                    errorListener === null || errorListener === void 0 ? void 0 : errorListener(err);
                }
                catch (err2) {
                    reportUnhandledError(err2);
                }
            }
        }
        catch (e_5_1) { e_5 = { error: e_5_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
            }
            finally { if (e_5) throw e_5.error; }
        }
        this.observers.clear();
        this.eventListeners.clear();
        if (reportError) {
            reportUnhandledError(err);
        }
    };
    class_1.prototype._error = function (err) {
        this._stopProcedure();
        this._reportError(err);
        if (this._parent) {
            this.system._relay(this, this._parent, createErrorActorEvent(this.id, err));
        }
    };
    // TODO: atm children don't belong entirely to the actor so
    // in a way - it's not even super aware of them
    // so we can't stop them from here but we really should!
    // right now, they are being stopped within the machine's transition
    // but that could throw and leave us with "orphaned" active actors
    class_1.prototype._stopProcedure = function () {
        if (this._processingStatus !== ProcessingStatus.Running) {
            return this;
        }
        this.system.scheduler.cancelAll(this);
        this.mailbox.clear();
        this.mailbox = new Mailbox(this._process.bind(this));
        this._processingStatus = ProcessingStatus.Stopped;
        this.system._unregister(this);
        return this;
    };
    /** @internal */
    class_1.prototype._send = function (event) {
        if (this._processingStatus === ProcessingStatus.Stopped) {
            return;
        }
        this.mailbox.enqueue(event);
    };
    /**
     * Sends an event to the running Actor to trigger a transition.
     *
     * @param event The event to send
     */
    class_1.prototype.send = function (event) {
        this.system._relay(void 0, this, event);
    };
    class_1.prototype.attachDevTools = function () {
        var devTools = this.options.devTools;
        if (devTools) {
            var resolvedDevToolsAdapter = typeof devTools === "function" ? devTools : devToolsAdapter;
            resolvedDevToolsAdapter(this);
        }
    };
    class_1.prototype.toJSON = function () {
        return {
            xstate$$type: $$ACTOR_TYPE,
            id: this.id
        };
    };
    /**
     * Obtain the internal state of the actor, which can be persisted.
     *
     * @remarks
     * The internal state can be persisted from any actor, not only machines.
     *
     * Note that the persisted state is not the same as the snapshot from
     * {@link Actor.getSnapshot}. Persisted state represents the internal state of
     * the actor, while snapshots represent the actor's last emitted value.
     *
     * Can be restored with {@link ActorOptions.state}
     * @see https://stately.ai/docs/persistence
     */
    class_1.prototype.getPersistedSnapshot = function (options) {
        return this.logic.getPersistedSnapshot(this._snapshot, options);
    };
    class_1.prototype[symbolObservable] = function () {
        return this;
    };
    /**
     * Read an actor’s snapshot synchronously.
     *
     * @remarks
     * The snapshot represent an actor's last emitted value.
     *
     * When an actor receives an event, its internal state may change. An actor
     * may emit a snapshot when a state transition occurs.
     *
     * Note that some actors, such as callback actors generated with
     * `fromCallback`, will not emit snapshots.
     * @see {@link Actor.subscribe} to subscribe to an actor’s snapshot values.
     * @see {@link Actor.getPersistedSnapshot} to persist the internal state of an actor (which is more than just a snapshot).
     */
    class_1.prototype.getSnapshot = function () {
        return this._snapshot;
    };
    return class_1;
}());
function createActor(logic) {
    var _a = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        _a[_i - 1] = arguments[_i];
    }
    var _b = __read(_a, 1), options = _b[0];
    return new Actor(logic, options);
}
var interpret = createActor;
function resolveCancel(_, snapshot, actionArgs, actionParams, _a) {
    var sendId = _a.sendId;
    var resolvedSendId = typeof sendId === "function" ? sendId(actionArgs, actionParams) : sendId;
    return [snapshot, {
            sendId: resolvedSendId
        }, void 0];
}
function executeCancel(actorScope, params) {
    actorScope.defer(function () {
        actorScope.system.scheduler.cancel(actorScope.self, params.sendId);
    });
}
function cancel(sendId) {
    function cancel2(_args, _params) {
    }
    cancel2.type = "xstate.cancel";
    cancel2.sendId = sendId;
    cancel2.resolve = resolveCancel;
    cancel2.execute = executeCancel;
    return cancel2;
}
function resolveSpawn(actorScope, snapshot, actionArgs, _actionParams, _a) {
    var _b;
    var id = _a.id, systemId = _a.systemId, src = _a.src, input = _a.input, syncSnapshot = _a.syncSnapshot;
    var logic = typeof src === "string" ? resolveReferencedActor(snapshot.machine, src) : src;
    var resolvedId = typeof id === "function" ? id(actionArgs) : id;
    var actorRef;
    var resolvedInput = void 0;
    if (logic) {
        resolvedInput = typeof input === "function" ? input({
            context: snapshot.context,
            event: actionArgs.event,
            self: actorScope.self
        }) : input;
        actorRef = createActor(logic, {
            id: resolvedId,
            src: src,
            parent: actorScope.self,
            syncSnapshot: syncSnapshot,
            systemId: systemId,
            input: resolvedInput
        });
    }
    return [cloneMachineSnapshot(snapshot, {
            children: __assign(__assign({}, snapshot.children), (_b = {}, _b[resolvedId] = actorRef, _b))
        }), {
            id: id,
            systemId: systemId,
            actorRef: actorRef,
            src: src,
            input: resolvedInput
        }, void 0];
}
function executeSpawn(actorScope, _a) {
    var actorRef = _a.actorRef;
    if (!actorRef) {
        return;
    }
    actorScope.defer(function () {
        if (actorRef._processingStatus === ProcessingStatus.Stopped) {
            return;
        }
        actorRef.start();
    });
}
function spawnChild() {
    var _a = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        _a[_i] = arguments[_i];
    }
    var _b = __read(_a, 2), src = _b[0], _c = _b[1], _d = _c === void 0 ? {} : _c, id = _d.id, systemId = _d.systemId, input = _d.input, _e = _d.syncSnapshot, syncSnapshot = _e === void 0 ? false : _e;
    function spawnChild2(_args, _params) {
    }
    spawnChild2.type = "xstate.spawnChild";
    spawnChild2.id = id;
    spawnChild2.systemId = systemId;
    spawnChild2.src = src;
    spawnChild2.input = input;
    spawnChild2.syncSnapshot = syncSnapshot;
    spawnChild2.resolve = resolveSpawn;
    spawnChild2.execute = executeSpawn;
    return spawnChild2;
}
function resolveStop(_, snapshot, args, actionParams, _a) {
    var actorRef = _a.actorRef;
    var actorRefOrString = typeof actorRef === "function" ? actorRef(args, actionParams) : actorRef;
    var resolvedActorRef = typeof actorRefOrString === "string" ? snapshot.children[actorRefOrString] : actorRefOrString;
    var children = snapshot.children;
    if (resolvedActorRef) {
        children = __assign({}, children);
        delete children[resolvedActorRef.id];
    }
    return [cloneMachineSnapshot(snapshot, {
            children: children
        }), resolvedActorRef, void 0];
}
function unregisterRecursively(actorScope, actorRef) {
    var e_6, _a;
    var snapshot = actorRef.getSnapshot();
    if (snapshot && "children" in snapshot) {
        try {
            for (var _b = __values(Object.values(snapshot.children)), _c = _b.next(); !_c.done; _c = _b.next()) {
                var child = _c.value;
                unregisterRecursively(actorScope, child);
            }
        }
        catch (e_6_1) { e_6 = { error: e_6_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
            }
            finally { if (e_6) throw e_6.error; }
        }
    }
    actorScope.system._unregister(actorRef);
}
function executeStop(actorScope, actorRef) {
    if (!actorRef) {
        return;
    }
    unregisterRecursively(actorScope, actorRef);
    if (actorRef._processingStatus !== ProcessingStatus.Running) {
        actorScope.stopChild(actorRef);
        return;
    }
    actorScope.defer(function () {
        actorScope.stopChild(actorRef);
    });
}
function stopChild(actorRef) {
    function stop2(_args, _params) {
    }
    stop2.type = "xstate.stopChild";
    stop2.actorRef = actorRef;
    stop2.resolve = resolveStop;
    stop2.execute = executeStop;
    return stop2;
}
var stop = stopChild;
function checkStateIn(snapshot, _, _a) {
    var stateValue = _a.stateValue;
    if (typeof stateValue === "string" && isStateId(stateValue)) {
        var target_1 = snapshot.machine.getStateNodeById(stateValue);
        return snapshot._nodes.some(function (sn) { return sn === target_1; });
    }
    return snapshot.matches(stateValue);
}
function stateIn(stateValue) {
    function stateIn2() {
        return false;
    }
    stateIn2.check = checkStateIn;
    stateIn2.stateValue = stateValue;
    return stateIn2;
}
function checkNot(snapshot, _a, _b) {
    var context = _a.context, event = _a.event;
    var guards = _b.guards;
    return !evaluateGuard(guards[0], context, event, snapshot);
}
function not(guard) {
    function not2(_args, _params) {
        return false;
    }
    not2.check = checkNot;
    not2.guards = [guard];
    return not2;
}
function checkAnd(snapshot, _a, _b) {
    var context = _a.context, event = _a.event;
    var guards = _b.guards;
    return guards.every(function (guard) { return evaluateGuard(guard, context, event, snapshot); });
}
function and(guards) {
    function and2(_args, _params) {
        return false;
    }
    and2.check = checkAnd;
    and2.guards = guards;
    return and2;
}
function checkOr(snapshot, _a, _b) {
    var context = _a.context, event = _a.event;
    var guards = _b.guards;
    return guards.some(function (guard) { return evaluateGuard(guard, context, event, snapshot); });
}
function or(guards) {
    function or2(_args, _params) {
        return false;
    }
    or2.check = checkOr;
    or2.guards = guards;
    return or2;
}
function evaluateGuard(guard, context, event, snapshot) {
    var machine = snapshot.machine;
    var isInline = typeof guard === "function";
    var resolved = isInline ? guard : machine.implementations.guards[typeof guard === "string" ? guard : guard.type];
    if (!isInline && !resolved) {
        throw new Error("Guard '".concat(typeof guard === "string" ? guard : guard.type, "' is not implemented.'."));
    }
    if (typeof resolved !== "function") {
        return evaluateGuard(resolved, context, event, snapshot);
    }
    var guardArgs = {
        context: context,
        event: event
    };
    var guardParams = isInline || typeof guard === "string" ? void 0 : "params" in guard ? typeof guard.params === "function" ? guard.params({
        context: context,
        event: event
    }) : guard.params : void 0;
    if (!("check" in resolved)) {
        return resolved(guardArgs, guardParams);
    }
    var builtinGuard = resolved;
    return builtinGuard.check(snapshot, guardArgs, resolved
    // this holds all params
    );
}
function isAtomicStateNode(stateNode) {
    return stateNode.type === "atomic" || stateNode.type === "final";
}
function getChildren(stateNode) {
    return Object.values(stateNode.states).filter(function (sn) { return sn.type !== "history"; });
}
function getProperAncestors(stateNode, toStateNode) {
    var ancestors = [];
    if (toStateNode === stateNode) {
        return ancestors;
    }
    var m = stateNode.parent;
    while (m && m !== toStateNode) {
        ancestors.push(m);
        m = m.parent;
    }
    return ancestors;
}
function getAllStateNodes(stateNodes) {
    var e_7, _a, e_8, _b, e_9, _c, e_10, _d;
    var nodeSet = new Set(stateNodes);
    var adjList = getAdjList(nodeSet);
    try {
        for (var nodeSet_1 = __values(nodeSet), nodeSet_1_1 = nodeSet_1.next(); !nodeSet_1_1.done; nodeSet_1_1 = nodeSet_1.next()) {
            var s = nodeSet_1_1.value;
            if (s.type === "compound" && (!adjList.get(s) || !adjList.get(s).length)) {
                getInitialStateNodesWithTheirAncestors(s).forEach(function (sn) { return nodeSet.add(sn); });
            }
            else {
                if (s.type === "parallel") {
                    try {
                        for (var _e = (e_8 = void 0, __values(getChildren(s))), _f = _e.next(); !_f.done; _f = _e.next()) {
                            var child = _f.value;
                            if (child.type === "history") {
                                continue;
                            }
                            if (!nodeSet.has(child)) {
                                var initialStates = getInitialStateNodesWithTheirAncestors(child);
                                try {
                                    for (var initialStates_1 = (e_9 = void 0, __values(initialStates)), initialStates_1_1 = initialStates_1.next(); !initialStates_1_1.done; initialStates_1_1 = initialStates_1.next()) {
                                        var initialStateNode = initialStates_1_1.value;
                                        nodeSet.add(initialStateNode);
                                    }
                                }
                                catch (e_9_1) { e_9 = { error: e_9_1 }; }
                                finally {
                                    try {
                                        if (initialStates_1_1 && !initialStates_1_1.done && (_c = initialStates_1.return)) _c.call(initialStates_1);
                                    }
                                    finally { if (e_9) throw e_9.error; }
                                }
                            }
                        }
                    }
                    catch (e_8_1) { e_8 = { error: e_8_1 }; }
                    finally {
                        try {
                            if (_f && !_f.done && (_b = _e.return)) _b.call(_e);
                        }
                        finally { if (e_8) throw e_8.error; }
                    }
                }
            }
        }
    }
    catch (e_7_1) { e_7 = { error: e_7_1 }; }
    finally {
        try {
            if (nodeSet_1_1 && !nodeSet_1_1.done && (_a = nodeSet_1.return)) _a.call(nodeSet_1);
        }
        finally { if (e_7) throw e_7.error; }
    }
    try {
        for (var nodeSet_2 = __values(nodeSet), nodeSet_2_1 = nodeSet_2.next(); !nodeSet_2_1.done; nodeSet_2_1 = nodeSet_2.next()) {
            var s = nodeSet_2_1.value;
            var m = s.parent;
            while (m) {
                nodeSet.add(m);
                m = m.parent;
            }
        }
    }
    catch (e_10_1) { e_10 = { error: e_10_1 }; }
    finally {
        try {
            if (nodeSet_2_1 && !nodeSet_2_1.done && (_d = nodeSet_2.return)) _d.call(nodeSet_2);
        }
        finally { if (e_10) throw e_10.error; }
    }
    return nodeSet;
}
function getValueFromAdj(baseNode, adjList) {
    var e_11, _a;
    var childStateNodes = adjList.get(baseNode);
    if (!childStateNodes) {
        return {};
    }
    if (baseNode.type === "compound") {
        var childStateNode = childStateNodes[0];
        if (childStateNode) {
            if (isAtomicStateNode(childStateNode)) {
                return childStateNode.key;
            }
        }
        else {
            return {};
        }
    }
    var stateValue = {};
    try {
        for (var childStateNodes_1 = __values(childStateNodes), childStateNodes_1_1 = childStateNodes_1.next(); !childStateNodes_1_1.done; childStateNodes_1_1 = childStateNodes_1.next()) {
            var childStateNode = childStateNodes_1_1.value;
            stateValue[childStateNode.key] = getValueFromAdj(childStateNode, adjList);
        }
    }
    catch (e_11_1) { e_11 = { error: e_11_1 }; }
    finally {
        try {
            if (childStateNodes_1_1 && !childStateNodes_1_1.done && (_a = childStateNodes_1.return)) _a.call(childStateNodes_1);
        }
        finally { if (e_11) throw e_11.error; }
    }
    return stateValue;
}
function getAdjList(stateNodes) {
    var e_12, _a;
    var adjList = /* @__PURE__ */ new Map();
    try {
        for (var stateNodes_1 = __values(stateNodes), stateNodes_1_1 = stateNodes_1.next(); !stateNodes_1_1.done; stateNodes_1_1 = stateNodes_1.next()) {
            var s = stateNodes_1_1.value;
            if (!adjList.has(s)) {
                adjList.set(s, []);
            }
            if (s.parent) {
                if (!adjList.has(s.parent)) {
                    adjList.set(s.parent, []);
                }
                adjList.get(s.parent).push(s);
            }
        }
    }
    catch (e_12_1) { e_12 = { error: e_12_1 }; }
    finally {
        try {
            if (stateNodes_1_1 && !stateNodes_1_1.done && (_a = stateNodes_1.return)) _a.call(stateNodes_1);
        }
        finally { if (e_12) throw e_12.error; }
    }
    return adjList;
}
function getStateValue(rootNode, stateNodes) {
    var config = getAllStateNodes(stateNodes);
    return getValueFromAdj(rootNode, getAdjList(config));
}
function isInFinalState(stateNodeSet, stateNode) {
    if (stateNode.type === "compound") {
        return getChildren(stateNode).some(function (s) { return s.type === "final" && stateNodeSet.has(s); });
    }
    if (stateNode.type === "parallel") {
        return getChildren(stateNode).every(function (sn) { return isInFinalState(stateNodeSet, sn); });
    }
    return stateNode.type === "final";
}
var isStateId = function (str) { return str[0] === STATE_IDENTIFIER; };
function getCandidates(stateNode, receivedEventType) {
    var exactMatch = stateNode.transitions.get(receivedEventType);
    var wildcardCandidates = __spreadArray([], __read(stateNode.transitions.keys()), false).filter(function (eventDescriptor) { return eventDescriptor !== receivedEventType && matchesEventDescriptor(receivedEventType, eventDescriptor); }).sort(function (a, b) { return b.length - a.length; }).flatMap(function (key) { return stateNode.transitions.get(key); });
    return exactMatch ? __spreadArray(__spreadArray([], __read(exactMatch), false), __read(wildcardCandidates), false) : wildcardCandidates;
}
function getDelayedTransitions(stateNode) {
    var afterConfig = stateNode.config.after;
    if (!afterConfig) {
        return [];
    }
    var mutateEntryExit = function (delay) {
        var afterEvent = createAfterEvent(delay, stateNode.id);
        var eventType = afterEvent.type;
        stateNode.entry.push(raise(afterEvent, {
            id: eventType,
            delay: delay
        }));
        stateNode.exit.push(cancel(eventType));
        return eventType;
    };
    var delayedTransitions = Object.keys(afterConfig).flatMap(function (delay) {
        var configTransition = afterConfig[delay];
        var resolvedTransition = typeof configTransition === "string" ? {
            target: configTransition
        } : configTransition;
        var resolvedDelay = Number.isNaN(+delay) ? delay : +delay;
        var eventType = mutateEntryExit(resolvedDelay);
        return toArray(resolvedTransition).map(function (transition2) { return (__assign(__assign({}, transition2), { event: eventType, delay: resolvedDelay })); });
    });
    return delayedTransitions.map(function (delayedTransition) {
        var delay = delayedTransition.delay;
        return __assign(__assign({}, formatTransition(stateNode, delayedTransition.event, delayedTransition)), { delay: delay });
    });
}
function formatTransition(stateNode, descriptor, transitionConfig) {
    var _a;
    var normalizedTarget = normalizeTarget(transitionConfig.target);
    var reenter = (_a = transitionConfig.reenter) !== null && _a !== void 0 ? _a : false;
    var target = resolveTarget(stateNode, normalizedTarget);
    var transition2 = __assign(__assign({}, transitionConfig), { actions: toArray(transitionConfig.actions), guard: transitionConfig.guard, target: target, source: stateNode, reenter: reenter, eventType: descriptor, toJSON: function () { return (__assign(__assign({}, transition2), { source: "#".concat(stateNode.id), target: target ? target.map(function (t) { return "#".concat(t.id); }) : void 0 })); } });
    return transition2;
}
function formatTransitions(stateNode) {
    var e_13, _a, e_14, _b, e_15, _c;
    var transitions = /* @__PURE__ */ new Map();
    if (stateNode.config.on) {
        var _loop_1 = function (descriptor) {
            if (descriptor === NULL_EVENT) {
                throw new Error('Null events ("") cannot be specified as a transition key. Use `always: { ... }` instead.');
            }
            var transitionsConfig = stateNode.config.on[descriptor];
            transitions.set(descriptor, toTransitionConfigArray(transitionsConfig).map(function (t) { return formatTransition(stateNode, descriptor, t); }));
        };
        try {
            for (var _d = __values(Object.keys(stateNode.config.on)), _e = _d.next(); !_e.done; _e = _d.next()) {
                var descriptor = _e.value;
                _loop_1(descriptor);
            }
        }
        catch (e_13_1) { e_13 = { error: e_13_1 }; }
        finally {
            try {
                if (_e && !_e.done && (_a = _d.return)) _a.call(_d);
            }
            finally { if (e_13) throw e_13.error; }
        }
    }
    if (stateNode.config.onDone) {
        var descriptor_1 = "xstate.done.state.".concat(stateNode.id);
        transitions.set(descriptor_1, toTransitionConfigArray(stateNode.config.onDone).map(function (t) { return formatTransition(stateNode, descriptor_1, t); }));
    }
    var _loop_2 = function (invokeDef) {
        if (invokeDef.onDone) {
            var descriptor_2 = "xstate.done.actor.".concat(invokeDef.id);
            transitions.set(descriptor_2, toTransitionConfigArray(invokeDef.onDone).map(function (t) { return formatTransition(stateNode, descriptor_2, t); }));
        }
        if (invokeDef.onError) {
            var descriptor_3 = "xstate.error.actor.".concat(invokeDef.id);
            transitions.set(descriptor_3, toTransitionConfigArray(invokeDef.onError).map(function (t) { return formatTransition(stateNode, descriptor_3, t); }));
        }
        if (invokeDef.onSnapshot) {
            var descriptor_4 = "xstate.snapshot.".concat(invokeDef.id);
            transitions.set(descriptor_4, toTransitionConfigArray(invokeDef.onSnapshot).map(function (t) { return formatTransition(stateNode, descriptor_4, t); }));
        }
    };
    try {
        for (var _f = __values(stateNode.invoke), _g = _f.next(); !_g.done; _g = _f.next()) {
            var invokeDef = _g.value;
            _loop_2(invokeDef);
        }
    }
    catch (e_14_1) { e_14 = { error: e_14_1 }; }
    finally {
        try {
            if (_g && !_g.done && (_b = _f.return)) _b.call(_f);
        }
        finally { if (e_14) throw e_14.error; }
    }
    try {
        for (var _h = __values(stateNode.after), _j = _h.next(); !_j.done; _j = _h.next()) {
            var delayedTransition = _j.value;
            var existing = transitions.get(delayedTransition.eventType);
            if (!existing) {
                existing = [];
                transitions.set(delayedTransition.eventType, existing);
            }
            existing.push(delayedTransition);
        }
    }
    catch (e_15_1) { e_15 = { error: e_15_1 }; }
    finally {
        try {
            if (_j && !_j.done && (_c = _h.return)) _c.call(_h);
        }
        finally { if (e_15) throw e_15.error; }
    }
    return transitions;
}
function formatRouteTransitions(rootStateNode) {
    var routeTransitions = [];
    var collectRoutes = function (states) {
        Object.values(states).forEach(function (sn) {
            if (sn.config.route && sn.config.id) {
                var routeId_1 = sn.config.id;
                var userGuard = sn.config.route.guard;
                var routeMatches = function (_a) {
                    var event = _a.event;
                    return event.to === "#".concat(routeId_1);
                };
                var transition2 = __assign(__assign({}, sn.config.route), { guard: userGuard ? and([routeMatches, userGuard]) : routeMatches, target: "#".concat(routeId_1) });
                routeTransitions.push(formatTransition(rootStateNode, "xstate.route", transition2));
            }
            if (sn.states) {
                collectRoutes(sn.states);
            }
        });
    };
    collectRoutes(rootStateNode.states);
    if (routeTransitions.length > 0) {
        rootStateNode.transitions.set("xstate.route", routeTransitions);
    }
}
function formatInitialTransition(stateNode, _target) {
    var resolvedTarget = typeof _target === "string" ? stateNode.states[_target] : _target ? stateNode.states[_target.target] : void 0;
    if (!resolvedTarget && _target) {
        throw new Error(
        // oxlint-disable-next-line typescript/restrict-template-expressions, typescript/no-base-to-string
        "Initial state node \"".concat(_target, "\" not found on parent state node #").concat(stateNode.id));
    }
    var transition2 = {
        source: stateNode,
        actions: !_target || typeof _target === "string" ? [] : toArray(_target.actions),
        eventType: null,
        reenter: false,
        target: resolvedTarget ? [resolvedTarget] : [],
        meta: typeof _target === "object" ? _target.meta : void 0,
        description: typeof _target === "object" ? _target.description : void 0,
        toJSON: function () { return (__assign(__assign({}, transition2), { source: "#".concat(stateNode.id), target: resolvedTarget ? ["#".concat(resolvedTarget.id)] : [] })); }
    };
    return transition2;
}
function resolveTarget(stateNode, targets) {
    if (targets === void 0) {
        return void 0;
    }
    return targets.map(function (target) {
        if (typeof target !== "string") {
            return target;
        }
        if (isStateId(target)) {
            return stateNode.machine.getStateNodeById(target);
        }
        var isInternalTarget = target[0] === STATE_DELIMITER;
        if (isInternalTarget && !stateNode.parent) {
            return getStateNodeByPath(stateNode, target.slice(1));
        }
        var resolvedTarget = isInternalTarget ? stateNode.key + target : target;
        if (stateNode.parent) {
            try {
                var targetStateNode = getStateNodeByPath(stateNode.parent, resolvedTarget);
                return targetStateNode;
            }
            catch (err) {
                throw new Error("Invalid transition definition for state node '".concat(stateNode.id, "':\n").concat(err.message));
            }
        }
        else {
            throw new Error("Invalid target: \"".concat(target, "\" is not a valid target from the root node. Did you mean \".").concat(target, "\"?"));
        }
    });
}
function resolveHistoryDefaultTransition(stateNode) {
    var normalizedTarget = normalizeTarget(stateNode.config.target);
    if (!normalizedTarget) {
        if (stateNode.parent.type === "parallel") {
            return {
                target: [stateNode.parent]
            };
        }
        return stateNode.parent.initial;
    }
    return {
        target: normalizedTarget.map(function (t) { return typeof t === "string" ? getStateNodeByPath(stateNode.parent, t) : t; })
    };
}
function isHistoryNode(stateNode) {
    return stateNode.type === "history";
}
function getInitialStateNodesWithTheirAncestors(stateNode) {
    var e_16, _a, e_17, _b;
    var states = getInitialStateNodes(stateNode);
    try {
        for (var states_1 = __values(states), states_1_1 = states_1.next(); !states_1_1.done; states_1_1 = states_1.next()) {
            var initialState = states_1_1.value;
            try {
                for (var _c = (e_17 = void 0, __values(getProperAncestors(initialState, stateNode))), _d = _c.next(); !_d.done; _d = _c.next()) {
                    var ancestor = _d.value;
                    states.add(ancestor);
                }
            }
            catch (e_17_1) { e_17 = { error: e_17_1 }; }
            finally {
                try {
                    if (_d && !_d.done && (_b = _c.return)) _b.call(_c);
                }
                finally { if (e_17) throw e_17.error; }
            }
        }
    }
    catch (e_16_1) { e_16 = { error: e_16_1 }; }
    finally {
        try {
            if (states_1_1 && !states_1_1.done && (_a = states_1.return)) _a.call(states_1);
        }
        finally { if (e_16) throw e_16.error; }
    }
    return states;
}
function getInitialStateNodes(stateNode) {
    var set = /* @__PURE__ */ new Set();
    function iter(descStateNode) {
        var e_18, _a;
        if (set.has(descStateNode)) {
            return;
        }
        set.add(descStateNode);
        if (descStateNode.type === "compound") {
            iter(descStateNode.initial.target[0]);
        }
        else if (descStateNode.type === "parallel") {
            try {
                for (var _b = __values(getChildren(descStateNode)), _c = _b.next(); !_c.done; _c = _b.next()) {
                    var child = _c.value;
                    iter(child);
                }
            }
            catch (e_18_1) { e_18 = { error: e_18_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                }
                finally { if (e_18) throw e_18.error; }
            }
        }
    }
    iter(stateNode);
    return set;
}
function getStateNode(stateNode, stateKey) {
    if (isStateId(stateKey)) {
        return stateNode.machine.getStateNodeById(stateKey);
    }
    if (!stateNode.states) {
        throw new Error("Unable to retrieve child state '".concat(stateKey, "' from '").concat(stateNode.id, "'; no child states exist."));
    }
    var result = stateNode.states[stateKey];
    if (!result) {
        throw new Error("Child state '".concat(stateKey, "' does not exist on '").concat(stateNode.id, "'"));
    }
    return result;
}
function getStateNodeByPath(stateNode, statePath) {
    if (typeof statePath === "string" && isStateId(statePath)) {
        try {
            return stateNode.machine.getStateNodeById(statePath);
        }
        catch (_a) {
        }
    }
    var arrayStatePath = toStatePath(statePath).slice();
    var currentStateNode = stateNode;
    while (arrayStatePath.length) {
        var key = arrayStatePath.shift();
        if (!key.length) {
            break;
        }
        currentStateNode = getStateNode(currentStateNode, key);
    }
    return currentStateNode;
}
function getStateNodes(stateNode, stateValue) {
    if (typeof stateValue === "string") {
        var childStateNode = stateNode.states[stateValue];
        if (!childStateNode) {
            throw new Error("State '".concat(stateValue, "' does not exist on '").concat(stateNode.id, "'"));
        }
        return [stateNode, childStateNode];
    }
    var childStateKeys = Object.keys(stateValue);
    var childStateNodes = childStateKeys.map(function (subStateKey) { return getStateNode(stateNode, subStateKey); }).filter(Boolean);
    return [stateNode.machine.root, stateNode].concat(childStateNodes, childStateKeys.reduce(function (allSubStateNodes, subStateKey) {
        var subStateNode = getStateNode(stateNode, subStateKey);
        if (!subStateNode) {
            return allSubStateNodes;
        }
        var subStateNodes = getStateNodes(subStateNode, stateValue[subStateKey]);
        return allSubStateNodes.concat(subStateNodes);
    }, []));
}
function transitionAtomicNode(stateNode, stateValue, snapshot, event) {
    var childStateNode = getStateNode(stateNode, stateValue);
    var next = childStateNode.next(snapshot, event);
    if (!next || !next.length) {
        return stateNode.next(snapshot, event);
    }
    return next;
}
function transitionCompoundNode(stateNode, stateValue, snapshot, event) {
    var subStateKeys = Object.keys(stateValue);
    var childStateNode = getStateNode(stateNode, subStateKeys[0]);
    var next = transitionNode(childStateNode, stateValue[subStateKeys[0]], snapshot, event);
    if (!next || !next.length) {
        return stateNode.next(snapshot, event);
    }
    return next;
}
function transitionParallelNode(stateNode, stateValue, snapshot, event) {
    var e_19, _a;
    var allInnerTransitions = [];
    try {
        for (var _b = __values(Object.keys(stateValue)), _c = _b.next(); !_c.done; _c = _b.next()) {
            var subStateKey = _c.value;
            var subStateValue = stateValue[subStateKey];
            if (!subStateValue) {
                continue;
            }
            var subStateNode = getStateNode(stateNode, subStateKey);
            var innerTransitions = transitionNode(subStateNode, subStateValue, snapshot, event);
            if (innerTransitions) {
                allInnerTransitions.push.apply(allInnerTransitions, __spreadArray([], __read(innerTransitions), false));
            }
        }
    }
    catch (e_19_1) { e_19 = { error: e_19_1 }; }
    finally {
        try {
            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
        }
        finally { if (e_19) throw e_19.error; }
    }
    if (!allInnerTransitions.length) {
        return stateNode.next(snapshot, event);
    }
    return allInnerTransitions;
}
function transitionNode(stateNode, stateValue, snapshot, event) {
    if (typeof stateValue === "string") {
        return transitionAtomicNode(stateNode, stateValue, snapshot, event);
    }
    if (Object.keys(stateValue).length === 1) {
        return transitionCompoundNode(stateNode, stateValue, snapshot, event);
    }
    return transitionParallelNode(stateNode, stateValue, snapshot, event);
}
function getHistoryNodes(stateNode) {
    return Object.keys(stateNode.states).map(function (key) { return stateNode.states[key]; }).filter(function (sn) { return sn.type === "history"; });
}
function isDescendant(childStateNode, parentStateNode) {
    var marker = childStateNode;
    while (marker.parent && marker.parent !== parentStateNode) {
        marker = marker.parent;
    }
    return marker.parent === parentStateNode;
}
function hasIntersection(s1, s2) {
    var e_20, _a, e_21, _b;
    var set1 = new Set(s1);
    var set2 = new Set(s2);
    try {
        for (var set1_1 = __values(set1), set1_1_1 = set1_1.next(); !set1_1_1.done; set1_1_1 = set1_1.next()) {
            var item = set1_1_1.value;
            if (set2.has(item)) {
                return true;
            }
        }
    }
    catch (e_20_1) { e_20 = { error: e_20_1 }; }
    finally {
        try {
            if (set1_1_1 && !set1_1_1.done && (_a = set1_1.return)) _a.call(set1_1);
        }
        finally { if (e_20) throw e_20.error; }
    }
    try {
        for (var set2_1 = __values(set2), set2_1_1 = set2_1.next(); !set2_1_1.done; set2_1_1 = set2_1.next()) {
            var item = set2_1_1.value;
            if (set1.has(item)) {
                return true;
            }
        }
    }
    catch (e_21_1) { e_21 = { error: e_21_1 }; }
    finally {
        try {
            if (set2_1_1 && !set2_1_1.done && (_b = set2_1.return)) _b.call(set2_1);
        }
        finally { if (e_21) throw e_21.error; }
    }
    return false;
}
function removeConflictingTransitions(enabledTransitions, stateNodeSet, historyValue) {
    var e_22, _a, e_23, _b, e_24, _c;
    var filteredTransitions = /* @__PURE__ */ new Set();
    try {
        for (var enabledTransitions_1 = __values(enabledTransitions), enabledTransitions_1_1 = enabledTransitions_1.next(); !enabledTransitions_1_1.done; enabledTransitions_1_1 = enabledTransitions_1.next()) {
            var t1 = enabledTransitions_1_1.value;
            var t1Preempted = false;
            var transitionsToRemove = /* @__PURE__ */ new Set();
            try {
                for (var filteredTransitions_1 = (e_23 = void 0, __values(filteredTransitions)), filteredTransitions_1_1 = filteredTransitions_1.next(); !filteredTransitions_1_1.done; filteredTransitions_1_1 = filteredTransitions_1.next()) {
                    var t2 = filteredTransitions_1_1.value;
                    if (hasIntersection(computeExitSet([t1], stateNodeSet, historyValue), computeExitSet([t2], stateNodeSet, historyValue))) {
                        if (isDescendant(t1.source, t2.source)) {
                            transitionsToRemove.add(t2);
                        }
                        else {
                            t1Preempted = true;
                            break;
                        }
                    }
                }
            }
            catch (e_23_1) { e_23 = { error: e_23_1 }; }
            finally {
                try {
                    if (filteredTransitions_1_1 && !filteredTransitions_1_1.done && (_b = filteredTransitions_1.return)) _b.call(filteredTransitions_1);
                }
                finally { if (e_23) throw e_23.error; }
            }
            if (!t1Preempted) {
                try {
                    for (var transitionsToRemove_1 = (e_24 = void 0, __values(transitionsToRemove)), transitionsToRemove_1_1 = transitionsToRemove_1.next(); !transitionsToRemove_1_1.done; transitionsToRemove_1_1 = transitionsToRemove_1.next()) {
                        var t3 = transitionsToRemove_1_1.value;
                        filteredTransitions.delete(t3);
                    }
                }
                catch (e_24_1) { e_24 = { error: e_24_1 }; }
                finally {
                    try {
                        if (transitionsToRemove_1_1 && !transitionsToRemove_1_1.done && (_c = transitionsToRemove_1.return)) _c.call(transitionsToRemove_1);
                    }
                    finally { if (e_24) throw e_24.error; }
                }
                filteredTransitions.add(t1);
            }
        }
    }
    catch (e_22_1) { e_22 = { error: e_22_1 }; }
    finally {
        try {
            if (enabledTransitions_1_1 && !enabledTransitions_1_1.done && (_a = enabledTransitions_1.return)) _a.call(enabledTransitions_1);
        }
        finally { if (e_22) throw e_22.error; }
    }
    return Array.from(filteredTransitions);
}
function findLeastCommonAncestor(stateNodes) {
    var e_25, _a;
    var _b = __read(stateNodes), head = _b[0], tail = _b.slice(1);
    var _loop_3 = function (ancestor) {
        if (tail.every(function (sn) { return isDescendant(sn, ancestor); })) {
            return { value: ancestor };
        }
    };
    try {
        for (var _c = __values(getProperAncestors(head, void 0)), _d = _c.next(); !_d.done; _d = _c.next()) {
            var ancestor = _d.value;
            var state_1 = _loop_3(ancestor);
            if (typeof state_1 === "object")
                return state_1.value;
        }
    }
    catch (e_25_1) { e_25 = { error: e_25_1 }; }
    finally {
        try {
            if (_d && !_d.done && (_a = _c.return)) _a.call(_c);
        }
        finally { if (e_25) throw e_25.error; }
    }
}
function getEffectiveTargetStates(transition2, historyValue) {
    var e_26, _a, e_27, _b, e_28, _c;
    if (!transition2.target) {
        return [];
    }
    var targets = /* @__PURE__ */ new Set();
    try {
        for (var _d = __values(transition2.target), _e = _d.next(); !_e.done; _e = _d.next()) {
            var targetNode = _e.value;
            if (isHistoryNode(targetNode)) {
                if (historyValue[targetNode.id]) {
                    try {
                        for (var _f = (e_27 = void 0, __values(historyValue[targetNode.id])), _g = _f.next(); !_g.done; _g = _f.next()) {
                            var node = _g.value;
                            targets.add(node);
                        }
                    }
                    catch (e_27_1) { e_27 = { error: e_27_1 }; }
                    finally {
                        try {
                            if (_g && !_g.done && (_b = _f.return)) _b.call(_f);
                        }
                        finally { if (e_27) throw e_27.error; }
                    }
                }
                else {
                    try {
                        for (var _h = (e_28 = void 0, __values(getEffectiveTargetStates(resolveHistoryDefaultTransition(targetNode), historyValue))), _j = _h.next(); !_j.done; _j = _h.next()) {
                            var node = _j.value;
                            targets.add(node);
                        }
                    }
                    catch (e_28_1) { e_28 = { error: e_28_1 }; }
                    finally {
                        try {
                            if (_j && !_j.done && (_c = _h.return)) _c.call(_h);
                        }
                        finally { if (e_28) throw e_28.error; }
                    }
                }
            }
            else {
                targets.add(targetNode);
            }
        }
    }
    catch (e_26_1) { e_26 = { error: e_26_1 }; }
    finally {
        try {
            if (_e && !_e.done && (_a = _d.return)) _a.call(_d);
        }
        finally { if (e_26) throw e_26.error; }
    }
    return __spreadArray([], __read(targets), false);
}
function getTransitionDomain(transition2, historyValue) {
    var targetStates = getEffectiveTargetStates(transition2, historyValue);
    if (!targetStates) {
        return;
    }
    if (!transition2.reenter && targetStates.every(function (target) { return target === transition2.source || isDescendant(target, transition2.source); })) {
        return transition2.source;
    }
    var lca = findLeastCommonAncestor(targetStates.concat(transition2.source));
    if (lca) {
        return lca;
    }
    if (transition2.reenter) {
        return;
    }
    return transition2.source.machine.root;
}
function computeExitSet(transitions, stateNodeSet, historyValue) {
    var e_29, _a, e_30, _b;
    var _c;
    var statesToExit = /* @__PURE__ */ new Set();
    try {
        for (var transitions_1 = __values(transitions), transitions_1_1 = transitions_1.next(); !transitions_1_1.done; transitions_1_1 = transitions_1.next()) {
            var t = transitions_1_1.value;
            if ((_c = t.target) === null || _c === void 0 ? void 0 : _c.length) {
                var domain = getTransitionDomain(t, historyValue);
                if (t.reenter && t.source === domain) {
                    statesToExit.add(domain);
                }
                try {
                    for (var stateNodeSet_1 = (e_30 = void 0, __values(stateNodeSet)), stateNodeSet_1_1 = stateNodeSet_1.next(); !stateNodeSet_1_1.done; stateNodeSet_1_1 = stateNodeSet_1.next()) {
                        var stateNode = stateNodeSet_1_1.value;
                        if (isDescendant(stateNode, domain)) {
                            statesToExit.add(stateNode);
                        }
                    }
                }
                catch (e_30_1) { e_30 = { error: e_30_1 }; }
                finally {
                    try {
                        if (stateNodeSet_1_1 && !stateNodeSet_1_1.done && (_b = stateNodeSet_1.return)) _b.call(stateNodeSet_1);
                    }
                    finally { if (e_30) throw e_30.error; }
                }
            }
        }
    }
    catch (e_29_1) { e_29 = { error: e_29_1 }; }
    finally {
        try {
            if (transitions_1_1 && !transitions_1_1.done && (_a = transitions_1.return)) _a.call(transitions_1);
        }
        finally { if (e_29) throw e_29.error; }
    }
    return __spreadArray([], __read(statesToExit), false);
}
function areStateNodeCollectionsEqual(prevStateNodes, nextStateNodeSet) {
    var e_31, _a;
    if (prevStateNodes.length !== nextStateNodeSet.size) {
        return false;
    }
    try {
        for (var prevStateNodes_1 = __values(prevStateNodes), prevStateNodes_1_1 = prevStateNodes_1.next(); !prevStateNodes_1_1.done; prevStateNodes_1_1 = prevStateNodes_1.next()) {
            var node = prevStateNodes_1_1.value;
            if (!nextStateNodeSet.has(node)) {
                return false;
            }
        }
    }
    catch (e_31_1) { e_31 = { error: e_31_1 }; }
    finally {
        try {
            if (prevStateNodes_1_1 && !prevStateNodes_1_1.done && (_a = prevStateNodes_1.return)) _a.call(prevStateNodes_1);
        }
        finally { if (e_31) throw e_31.error; }
    }
    return true;
}
function initialMicrostep(root, preInitialState, actorScope, initEvent, internalQueue) {
    return microstep([{
            target: __spreadArray([], __read(getInitialStateNodes(root)), false),
            source: root,
            reenter: true,
            actions: [],
            eventType: null,
            toJSON: null
        }], preInitialState, actorScope, initEvent, true, internalQueue);
}
function microstep(transitions, currentSnapshot, actorScope, event, isInitial, internalQueue) {
    var _a;
    var actions = [];
    if (!transitions.length) {
        return [currentSnapshot, actions];
    }
    var originalExecutor = actorScope.actionExecutor;
    actorScope.actionExecutor = function (action) {
        actions.push(action);
        originalExecutor(action);
    };
    try {
        var mutStateNodeSet = new Set(currentSnapshot._nodes);
        var historyValue = currentSnapshot.historyValue;
        var filteredTransitions = removeConflictingTransitions(transitions, mutStateNodeSet, historyValue);
        var nextState = currentSnapshot;
        if (!isInitial) {
            _a = __read(exitStates(nextState, event, actorScope, filteredTransitions, mutStateNodeSet, historyValue, internalQueue, actorScope.actionExecutor), 2), nextState = _a[0], historyValue = _a[1];
        }
        nextState = resolveActionsAndContext(nextState, event, actorScope, filteredTransitions.flatMap(function (t) { return t.actions; }), internalQueue, void 0);
        nextState = enterStates(nextState, event, actorScope, filteredTransitions, mutStateNodeSet, internalQueue, historyValue, isInitial);
        var nextStateNodes = __spreadArray([], __read(mutStateNodeSet), false);
        if (nextState.status === "done") {
            nextState = resolveActionsAndContext(nextState, event, actorScope, nextStateNodes.sort(function (a, b) { return b.order - a.order; }).flatMap(function (state) { return state.exit; }), internalQueue, void 0);
        }
        try {
            if (historyValue === currentSnapshot.historyValue && areStateNodeCollectionsEqual(currentSnapshot._nodes, mutStateNodeSet)) {
                return [nextState, actions];
            }
            return [cloneMachineSnapshot(nextState, {
                    _nodes: nextStateNodes,
                    historyValue: historyValue
                }), actions];
        }
        catch (e) {
            throw e;
        }
    }
    finally {
        actorScope.actionExecutor = originalExecutor;
    }
}
function getMachineOutput(snapshot, event, actorScope, rootNode, rootCompletionNode) {
    if (rootNode.output === void 0) {
        return;
    }
    var doneStateEvent = createDoneStateEvent(rootCompletionNode.id, rootCompletionNode.output !== void 0 && rootCompletionNode.parent ? resolveOutput(rootCompletionNode.output, snapshot.context, event, actorScope.self) : void 0);
    return resolveOutput(rootNode.output, snapshot.context, doneStateEvent, actorScope.self);
}
function enterStates(currentSnapshot, event, actorScope, filteredTransitions, mutStateNodeSet, internalQueue, historyValue, isInitial) {
    var e_32, _a, e_33, _b;
    var nextSnapshot = currentSnapshot;
    var statesToEnter = /* @__PURE__ */ new Set();
    var statesForDefaultEntry = /* @__PURE__ */ new Set();
    computeEntrySet(filteredTransitions, historyValue, statesForDefaultEntry, statesToEnter);
    if (isInitial) {
        statesForDefaultEntry.add(currentSnapshot.machine.root);
    }
    var completedNodes = /* @__PURE__ */ new Set();
    try {
        for (var _c = __values(__spreadArray([], __read(statesToEnter), false).sort(function (a, b) { return a.order - b.order; })), _d = _c.next(); !_d.done; _d = _c.next()) {
            var stateNodeToEnter = _d.value;
            mutStateNodeSet.add(stateNodeToEnter);
            var actions = [];
            actions.push.apply(actions, __spreadArray([], __read(stateNodeToEnter.entry), false));
            try {
                for (var _e = (e_33 = void 0, __values(stateNodeToEnter.invoke)), _f = _e.next(); !_f.done; _f = _e.next()) {
                    var invokeDef = _f.value;
                    actions.push(spawnChild(invokeDef.src, __assign(__assign({}, invokeDef), { syncSnapshot: !!invokeDef.onSnapshot })));
                }
            }
            catch (e_33_1) { e_33 = { error: e_33_1 }; }
            finally {
                try {
                    if (_f && !_f.done && (_b = _e.return)) _b.call(_e);
                }
                finally { if (e_33) throw e_33.error; }
            }
            if (statesForDefaultEntry.has(stateNodeToEnter)) {
                var initialActions = stateNodeToEnter.initial.actions;
                actions.push.apply(actions, __spreadArray([], __read(initialActions), false));
            }
            nextSnapshot = resolveActionsAndContext(nextSnapshot, event, actorScope, actions, internalQueue, stateNodeToEnter.invoke.map(function (invokeDef) { return invokeDef.id; }));
            if (stateNodeToEnter.type === "final") {
                var parent_1 = stateNodeToEnter.parent;
                var ancestorMarker = (parent_1 === null || parent_1 === void 0 ? void 0 : parent_1.type) === "parallel" ? parent_1 : parent_1 === null || parent_1 === void 0 ? void 0 : parent_1.parent;
                var rootCompletionNode = ancestorMarker || stateNodeToEnter;
                if ((parent_1 === null || parent_1 === void 0 ? void 0 : parent_1.type) === "compound") {
                    internalQueue.push(createDoneStateEvent(parent_1.id, stateNodeToEnter.output !== void 0 ? resolveOutput(stateNodeToEnter.output, nextSnapshot.context, event, actorScope.self) : void 0));
                }
                while ((ancestorMarker === null || ancestorMarker === void 0 ? void 0 : ancestorMarker.type) === "parallel" && !completedNodes.has(ancestorMarker) && isInFinalState(mutStateNodeSet, ancestorMarker)) {
                    completedNodes.add(ancestorMarker);
                    internalQueue.push(createDoneStateEvent(ancestorMarker.id));
                    rootCompletionNode = ancestorMarker;
                    ancestorMarker = ancestorMarker.parent;
                }
                if (ancestorMarker) {
                    continue;
                }
                nextSnapshot = cloneMachineSnapshot(nextSnapshot, {
                    status: "done",
                    output: getMachineOutput(nextSnapshot, event, actorScope, nextSnapshot.machine.root, rootCompletionNode)
                });
            }
        }
    }
    catch (e_32_1) { e_32 = { error: e_32_1 }; }
    finally {
        try {
            if (_d && !_d.done && (_a = _c.return)) _a.call(_c);
        }
        finally { if (e_32) throw e_32.error; }
    }
    return nextSnapshot;
}
function computeEntrySet(transitions, historyValue, statesForDefaultEntry, statesToEnter) {
    var e_34, _a, e_35, _b, e_36, _c;
    try {
        for (var transitions_2 = __values(transitions), transitions_2_1 = transitions_2.next(); !transitions_2_1.done; transitions_2_1 = transitions_2.next()) {
            var t = transitions_2_1.value;
            var domain = getTransitionDomain(t, historyValue);
            try {
                for (var _d = (e_35 = void 0, __values(t.target || [])), _e = _d.next(); !_e.done; _e = _d.next()) {
                    var s = _e.value;
                    if (!isHistoryNode(s) && // if the target is different than the source then it will *definitely* be entered
                        (t.source !== s || // we know that the domain can't lie within the source
                            // if it's different than the source then it's outside of it and it means that the target has to be entered as well
                            t.source !== domain || // reentering transitions always enter the target, even if it's the source itself
                            t.reenter)) {
                        statesToEnter.add(s);
                        statesForDefaultEntry.add(s);
                    }
                    addDescendantStatesToEnter(s, historyValue, statesForDefaultEntry, statesToEnter);
                }
            }
            catch (e_35_1) { e_35 = { error: e_35_1 }; }
            finally {
                try {
                    if (_e && !_e.done && (_b = _d.return)) _b.call(_d);
                }
                finally { if (e_35) throw e_35.error; }
            }
            var targetStates = getEffectiveTargetStates(t, historyValue);
            try {
                for (var targetStates_1 = (e_36 = void 0, __values(targetStates)), targetStates_1_1 = targetStates_1.next(); !targetStates_1_1.done; targetStates_1_1 = targetStates_1.next()) {
                    var s = targetStates_1_1.value;
                    var ancestors = getProperAncestors(s, domain);
                    if ((domain === null || domain === void 0 ? void 0 : domain.type) === "parallel") {
                        ancestors.push(domain);
                    }
                    addAncestorStatesToEnter(statesToEnter, historyValue, statesForDefaultEntry, ancestors, !t.source.parent && t.reenter ? void 0 : domain);
                }
            }
            catch (e_36_1) { e_36 = { error: e_36_1 }; }
            finally {
                try {
                    if (targetStates_1_1 && !targetStates_1_1.done && (_c = targetStates_1.return)) _c.call(targetStates_1);
                }
                finally { if (e_36) throw e_36.error; }
            }
        }
    }
    catch (e_34_1) { e_34 = { error: e_34_1 }; }
    finally {
        try {
            if (transitions_2_1 && !transitions_2_1.done && (_a = transitions_2.return)) _a.call(transitions_2);
        }
        finally { if (e_34) throw e_34.error; }
    }
}
function addDescendantStatesToEnter(stateNode, historyValue, statesForDefaultEntry, statesToEnter) {
    var e_37, _a, e_38, _b, e_39, _c, e_40, _d, e_41, _e;
    var _f;
    if (isHistoryNode(stateNode)) {
        if (historyValue[stateNode.id]) {
            var historyStateNodes = historyValue[stateNode.id];
            try {
                for (var historyStateNodes_1 = __values(historyStateNodes), historyStateNodes_1_1 = historyStateNodes_1.next(); !historyStateNodes_1_1.done; historyStateNodes_1_1 = historyStateNodes_1.next()) {
                    var s = historyStateNodes_1_1.value;
                    statesToEnter.add(s);
                    addDescendantStatesToEnter(s, historyValue, statesForDefaultEntry, statesToEnter);
                }
            }
            catch (e_37_1) { e_37 = { error: e_37_1 }; }
            finally {
                try {
                    if (historyStateNodes_1_1 && !historyStateNodes_1_1.done && (_a = historyStateNodes_1.return)) _a.call(historyStateNodes_1);
                }
                finally { if (e_37) throw e_37.error; }
            }
            try {
                for (var historyStateNodes_2 = __values(historyStateNodes), historyStateNodes_2_1 = historyStateNodes_2.next(); !historyStateNodes_2_1.done; historyStateNodes_2_1 = historyStateNodes_2.next()) {
                    var s = historyStateNodes_2_1.value;
                    addProperAncestorStatesToEnter(s, stateNode.parent, statesToEnter, historyValue, statesForDefaultEntry);
                }
            }
            catch (e_38_1) { e_38 = { error: e_38_1 }; }
            finally {
                try {
                    if (historyStateNodes_2_1 && !historyStateNodes_2_1.done && (_b = historyStateNodes_2.return)) _b.call(historyStateNodes_2);
                }
                finally { if (e_38) throw e_38.error; }
            }
        }
        else {
            var historyDefaultTransition = resolveHistoryDefaultTransition(stateNode);
            try {
                for (var _g = __values(historyDefaultTransition.target), _h = _g.next(); !_h.done; _h = _g.next()) {
                    var s = _h.value;
                    statesToEnter.add(s);
                    if (historyDefaultTransition === ((_f = stateNode.parent) === null || _f === void 0 ? void 0 : _f.initial)) {
                        statesForDefaultEntry.add(stateNode.parent);
                    }
                    addDescendantStatesToEnter(s, historyValue, statesForDefaultEntry, statesToEnter);
                }
            }
            catch (e_39_1) { e_39 = { error: e_39_1 }; }
            finally {
                try {
                    if (_h && !_h.done && (_c = _g.return)) _c.call(_g);
                }
                finally { if (e_39) throw e_39.error; }
            }
            try {
                for (var _j = __values(historyDefaultTransition.target), _k = _j.next(); !_k.done; _k = _j.next()) {
                    var s = _k.value;
                    addProperAncestorStatesToEnter(s, stateNode.parent, statesToEnter, historyValue, statesForDefaultEntry);
                }
            }
            catch (e_40_1) { e_40 = { error: e_40_1 }; }
            finally {
                try {
                    if (_k && !_k.done && (_d = _j.return)) _d.call(_j);
                }
                finally { if (e_40) throw e_40.error; }
            }
        }
    }
    else {
        if (stateNode.type === "compound") {
            var _l = __read(stateNode.initial.target, 1), initialState = _l[0];
            if (!isHistoryNode(initialState)) {
                statesToEnter.add(initialState);
                statesForDefaultEntry.add(initialState);
            }
            addDescendantStatesToEnter(initialState, historyValue, statesForDefaultEntry, statesToEnter);
            addProperAncestorStatesToEnter(initialState, stateNode, statesToEnter, historyValue, statesForDefaultEntry);
        }
        else {
            if (stateNode.type === "parallel") {
                var _loop_4 = function (child) {
                    if (!__spreadArray([], __read(statesToEnter), false).some(function (s) { return isDescendant(s, child); })) {
                        if (!isHistoryNode(child)) {
                            statesToEnter.add(child);
                            statesForDefaultEntry.add(child);
                        }
                        addDescendantStatesToEnter(child, historyValue, statesForDefaultEntry, statesToEnter);
                    }
                };
                try {
                    for (var _m = __values(getChildren(stateNode).filter(function (sn) { return !isHistoryNode(sn); })), _o = _m.next(); !_o.done; _o = _m.next()) {
                        var child = _o.value;
                        _loop_4(child);
                    }
                }
                catch (e_41_1) { e_41 = { error: e_41_1 }; }
                finally {
                    try {
                        if (_o && !_o.done && (_e = _m.return)) _e.call(_m);
                    }
                    finally { if (e_41) throw e_41.error; }
                }
            }
        }
    }
}
function addAncestorStatesToEnter(statesToEnter, historyValue, statesForDefaultEntry, ancestors, reentrancyDomain) {
    var e_42, _a, e_43, _b;
    try {
        for (var ancestors_1 = __values(ancestors), ancestors_1_1 = ancestors_1.next(); !ancestors_1_1.done; ancestors_1_1 = ancestors_1.next()) {
            var anc = ancestors_1_1.value;
            if (!reentrancyDomain || isDescendant(anc, reentrancyDomain)) {
                statesToEnter.add(anc);
            }
            if (anc.type === "parallel") {
                var _loop_5 = function (child) {
                    if (!__spreadArray([], __read(statesToEnter), false).some(function (s) { return isDescendant(s, child); })) {
                        statesToEnter.add(child);
                        addDescendantStatesToEnter(child, historyValue, statesForDefaultEntry, statesToEnter);
                    }
                };
                try {
                    for (var _c = (e_43 = void 0, __values(getChildren(anc).filter(function (sn) { return !isHistoryNode(sn); }))), _d = _c.next(); !_d.done; _d = _c.next()) {
                        var child = _d.value;
                        _loop_5(child);
                    }
                }
                catch (e_43_1) { e_43 = { error: e_43_1 }; }
                finally {
                    try {
                        if (_d && !_d.done && (_b = _c.return)) _b.call(_c);
                    }
                    finally { if (e_43) throw e_43.error; }
                }
            }
        }
    }
    catch (e_42_1) { e_42 = { error: e_42_1 }; }
    finally {
        try {
            if (ancestors_1_1 && !ancestors_1_1.done && (_a = ancestors_1.return)) _a.call(ancestors_1);
        }
        finally { if (e_42) throw e_42.error; }
    }
}
function addProperAncestorStatesToEnter(stateNode, toStateNode, statesToEnter, historyValue, statesForDefaultEntry) {
    addAncestorStatesToEnter(statesToEnter, historyValue, statesForDefaultEntry, getProperAncestors(stateNode, toStateNode));
}
function exitStates(currentSnapshot, event, actorScope, transitions, mutStateNodeSet, historyValue, internalQueue, _actionExecutor) {
    var e_44, _a, e_45, _b;
    var nextSnapshot = currentSnapshot;
    var statesToExit = computeExitSet(transitions, mutStateNodeSet, historyValue);
    statesToExit.sort(function (a, b) { return b.order - a.order; });
    var changedHistory;
    var _loop_6 = function (exitStateNode) {
        var e_46, _c;
        try {
            for (var _d = (e_46 = void 0, __values(getHistoryNodes(exitStateNode))), _e = _d.next(); !_e.done; _e = _d.next()) {
                var historyNode = _e.value;
                var predicate = void 0;
                if (historyNode.history === "deep") {
                    predicate = function (sn) { return isAtomicStateNode(sn) && isDescendant(sn, exitStateNode); };
                }
                else {
                    predicate = function (sn) {
                        return sn.parent === exitStateNode;
                    };
                }
                changedHistory !== null && changedHistory !== void 0 ? changedHistory : (changedHistory = __assign({}, historyValue));
                changedHistory[historyNode.id] = Array.from(mutStateNodeSet).filter(predicate);
            }
        }
        catch (e_46_1) { e_46 = { error: e_46_1 }; }
        finally {
            try {
                if (_e && !_e.done && (_c = _d.return)) _c.call(_d);
            }
            finally { if (e_46) throw e_46.error; }
        }
    };
    try {
        for (var statesToExit_1 = __values(statesToExit), statesToExit_1_1 = statesToExit_1.next(); !statesToExit_1_1.done; statesToExit_1_1 = statesToExit_1.next()) {
            var exitStateNode = statesToExit_1_1.value;
            _loop_6(exitStateNode);
        }
    }
    catch (e_44_1) { e_44 = { error: e_44_1 }; }
    finally {
        try {
            if (statesToExit_1_1 && !statesToExit_1_1.done && (_a = statesToExit_1.return)) _a.call(statesToExit_1);
        }
        finally { if (e_44) throw e_44.error; }
    }
    try {
        for (var statesToExit_2 = __values(statesToExit), statesToExit_2_1 = statesToExit_2.next(); !statesToExit_2_1.done; statesToExit_2_1 = statesToExit_2.next()) {
            var s = statesToExit_2_1.value;
            nextSnapshot = resolveActionsAndContext(nextSnapshot, event, actorScope, __spreadArray(__spreadArray([], __read(s.exit), false), __read(s.invoke.map(function (def) { return stopChild(def.id); })), false), internalQueue, void 0);
            mutStateNodeSet.delete(s);
        }
    }
    catch (e_45_1) { e_45 = { error: e_45_1 }; }
    finally {
        try {
            if (statesToExit_2_1 && !statesToExit_2_1.done && (_b = statesToExit_2.return)) _b.call(statesToExit_2);
        }
        finally { if (e_45) throw e_45.error; }
    }
    return [nextSnapshot, changedHistory || historyValue];
}
function getAction(machine, actionType) {
    return machine.implementations.actions[actionType];
}
function resolveAndExecuteActionsWithContext(currentSnapshot, event, actorScope, actions, extra, retries) {
    var e_47, _a;
    var machine = currentSnapshot.machine;
    var intermediateSnapshot = currentSnapshot;
    try {
        for (var actions_1 = __values(actions), actions_1_1 = actions_1.next(); !actions_1_1.done; actions_1_1 = actions_1.next()) {
            var action = actions_1_1.value;
            var isInline = typeof action === "function";
            var resolvedAction = isInline ? action : (
            // the existing type of `.actions` assumes non-nullable `TExpressionAction`
            // it's fine to cast this here to get a common type and lack of errors in the rest of the code
            // our logic below makes sure that we call those 2 "variants" correctly
            getAction(machine, typeof action === "string" ? action : action.type));
            var actionArgs = {
                context: intermediateSnapshot.context,
                event: event,
                self: actorScope.self,
                system: actorScope.system
            };
            var actionParams = isInline || typeof action === "string" ? void 0 : "params" in action ? typeof action.params === "function" ? action.params({
                context: intermediateSnapshot.context,
                event: event
            }) : action.params : void 0;
            if (!resolvedAction || !("resolve" in resolvedAction)) {
                actorScope.actionExecutor({
                    type: typeof action === "string" ? action : typeof action === "object" ? action.type : action.name || "(anonymous)",
                    info: actionArgs,
                    params: actionParams,
                    exec: resolvedAction
                });
                continue;
            }
            var builtinAction = resolvedAction;
            var _b = __read(builtinAction.resolve(actorScope, intermediateSnapshot, actionArgs, actionParams, resolvedAction, 
            // this holds all params
            extra), 3), nextState = _b[0], params = _b[1], actions2 = _b[2];
            intermediateSnapshot = nextState;
            if ("retryResolve" in builtinAction) {
                retries === null || retries === void 0 ? void 0 : retries.push([builtinAction, params]);
            }
            if ("execute" in builtinAction) {
                actorScope.actionExecutor({
                    type: builtinAction.type,
                    info: actionArgs,
                    params: params,
                    exec: builtinAction.execute.bind(null, actorScope, params)
                });
            }
            if (actions2) {
                intermediateSnapshot = resolveAndExecuteActionsWithContext(intermediateSnapshot, event, actorScope, actions2, extra, retries);
            }
        }
    }
    catch (e_47_1) { e_47 = { error: e_47_1 }; }
    finally {
        try {
            if (actions_1_1 && !actions_1_1.done && (_a = actions_1.return)) _a.call(actions_1);
        }
        finally { if (e_47) throw e_47.error; }
    }
    return intermediateSnapshot;
}
function resolveActionsAndContext(currentSnapshot, event, actorScope, actions, internalQueue, deferredActorIds) {
    var retries = deferredActorIds ? [] : void 0;
    var nextState = resolveAndExecuteActionsWithContext(currentSnapshot, event, actorScope, actions, {
        internalQueue: internalQueue,
        deferredActorIds: deferredActorIds
    }, retries);
    retries === null || retries === void 0 ? void 0 : retries.forEach(function (_a) {
        var _b = __read(_a, 2), builtinAction = _b[0], params = _b[1];
        builtinAction.retryResolve(actorScope, nextState, params);
    });
    return nextState;
}
function macrostep(snapshot, event, actorScope, internalQueue) {
    var _a, _b;
    var nextSnapshot = snapshot;
    var microsteps = [];
    function addMicrostep(step, event2, transitions) {
        actorScope.system._sendInspectionEvent({
            type: "@xstate.microstep",
            actorRef: actorScope.self,
            event: event2,
            snapshot: step[0],
            _transitions: transitions
        });
        microsteps.push(step);
    }
    if (event.type === XSTATE_STOP) {
        nextSnapshot = cloneMachineSnapshot(stopChildren(nextSnapshot, event, actorScope), {
            status: "stopped"
        });
        addMicrostep([nextSnapshot, []], event, []);
        return {
            snapshot: nextSnapshot,
            microsteps: microsteps
        };
    }
    var nextEvent = event;
    if (nextEvent.type !== XSTATE_INIT) {
        var currentEvent = nextEvent;
        var isErr = isErrorActorEvent(currentEvent);
        var transitions = selectTransitions(currentEvent, nextSnapshot);
        if (isErr && !transitions.length) {
            nextSnapshot = cloneMachineSnapshot(snapshot, {
                status: "error",
                error: currentEvent.error
            });
            addMicrostep([nextSnapshot, []], currentEvent, []);
            return {
                snapshot: nextSnapshot,
                microsteps: microsteps
            };
        }
        var step = microstep(transitions, snapshot, actorScope, nextEvent, false, 
        // isInitial
        internalQueue);
        nextSnapshot = step[0];
        addMicrostep(step, currentEvent, transitions);
    }
    var shouldSelectEventlessTransitions = true;
    var maxIterations = (_b = (_a = snapshot.machine.options) === null || _a === void 0 ? void 0 : _a.maxIterations) !== null && _b !== void 0 ? _b : Infinity;
    var iterationCount = 0;
    while (nextSnapshot.status === "active") {
        iterationCount++;
        if (iterationCount > maxIterations) {
            throw new Error("Infinite loop detected: the machine has processed more than ".concat(maxIterations, " microsteps without reaching a stable state. This usually happens when there's a cycle of transitions (e.g., eventless transitions or raised events causing state A -> B -> C -> A)."));
        }
        var enabledTransitions = shouldSelectEventlessTransitions ? selectEventlessTransitions(nextSnapshot, nextEvent) : [];
        var previousState = enabledTransitions.length ? nextSnapshot : void 0;
        if (!enabledTransitions.length) {
            if (!internalQueue.length) {
                break;
            }
            nextEvent = internalQueue.shift();
            enabledTransitions = selectTransitions(nextEvent, nextSnapshot);
        }
        var step = microstep(enabledTransitions, nextSnapshot, actorScope, nextEvent, false, internalQueue);
        nextSnapshot = step[0];
        shouldSelectEventlessTransitions = nextSnapshot !== previousState;
        addMicrostep(step, nextEvent, enabledTransitions);
    }
    if (nextSnapshot.status !== "active") {
        stopChildren(nextSnapshot, nextEvent, actorScope);
    }
    return {
        snapshot: nextSnapshot,
        microsteps: microsteps
    };
}
function stopChildren(nextState, event, actorScope) {
    return resolveActionsAndContext(nextState, event, actorScope, Object.values(nextState.children).map(function (child) { return stopChild(child); }), [], void 0);
}
function selectTransitions(event, nextState) {
    return nextState.machine.getTransitionData(nextState, event);
}
function selectEventlessTransitions(nextState, event) {
    var e_48, _a, e_49, _b, e_50, _c;
    var enabledTransitionSet = /* @__PURE__ */ new Set();
    var atomicStates = nextState._nodes.filter(isAtomicStateNode);
    try {
        for (var atomicStates_1 = __values(atomicStates), atomicStates_1_1 = atomicStates_1.next(); !atomicStates_1_1.done; atomicStates_1_1 = atomicStates_1.next()) {
            var stateNode = atomicStates_1_1.value;
            try {
                loop: for (var _d = (e_49 = void 0, __values([stateNode].concat(getProperAncestors(stateNode, void 0)))), _e = _d.next(); !_e.done; _e = _d.next()) {
                    var s = _e.value;
                    if (!s.always) {
                        continue;
                    }
                    try {
                        for (var _f = (e_50 = void 0, __values(s.always)), _g = _f.next(); !_g.done; _g = _f.next()) {
                            var transition2 = _g.value;
                            if (transition2.guard === void 0 || evaluateGuard(transition2.guard, nextState.context, event, nextState)) {
                                enabledTransitionSet.add(transition2);
                                break loop;
                            }
                        }
                    }
                    catch (e_50_1) { e_50 = { error: e_50_1 }; }
                    finally {
                        try {
                            if (_g && !_g.done && (_c = _f.return)) _c.call(_f);
                        }
                        finally { if (e_50) throw e_50.error; }
                    }
                }
            }
            catch (e_49_1) { e_49 = { error: e_49_1 }; }
            finally {
                try {
                    if (_e && !_e.done && (_b = _d.return)) _b.call(_d);
                }
                finally { if (e_49) throw e_49.error; }
            }
        }
    }
    catch (e_48_1) { e_48 = { error: e_48_1 }; }
    finally {
        try {
            if (atomicStates_1_1 && !atomicStates_1_1.done && (_a = atomicStates_1.return)) _a.call(atomicStates_1);
        }
        finally { if (e_48) throw e_48.error; }
    }
    return removeConflictingTransitions(Array.from(enabledTransitionSet), new Set(nextState._nodes), nextState.historyValue);
}
function resolveStateValue(rootNode, stateValue) {
    var allStateNodes = getAllStateNodes(getStateNodes(rootNode, stateValue));
    return getStateValue(rootNode, __spreadArray([], __read(allStateNodes), false));
}
function isMachineSnapshot(value) {
    return !!value && typeof value === "object" && "machine" in value && "value" in value;
}
var machineSnapshotMatches = function matches(testValue) {
    return matchesState(testValue, this.value);
};
var machineSnapshotHasTag = function hasTag(tag) {
    return this.tags.has(tag);
};
var machineSnapshotCan = function can(event) {
    var transitionData = this.machine.getTransitionData(this, event);
    return !!(transitionData === null || transitionData === void 0 ? void 0 : transitionData.length) && // Check that at least one transition is not forbidden
        transitionData.some(function (t) { return t.target !== void 0 || t.actions.length; });
};
var machineSnapshotToJSON = function toJSON() {
    var _a = this, nodes = _a._nodes, tags = _a.tags, machine = _a.machine, getMeta2 = _a.getMeta, toJSON2 = _a.toJSON, can2 = _a.can, hasTag2 = _a.hasTag, matches2 = _a.matches, jsonValues = __rest(_a, ["_nodes", "tags", "machine", "getMeta", "toJSON", "can", "hasTag", "matches"]);
    return __assign(__assign({}, jsonValues), { tags: Array.from(tags) });
};
var machineSnapshotGetMeta = function getMeta() {
    return this._nodes.reduce(function (acc, stateNode) {
        if (stateNode.meta !== void 0) {
            acc[stateNode.id] = stateNode.meta;
        }
        return acc;
    }, {});
};
function createMachineSnapshot(config, machine) {
    return {
        status: config.status,
        output: config.output,
        error: config.error,
        machine: machine,
        context: config.context,
        _nodes: config._nodes,
        value: getStateValue(machine.root, config._nodes),
        tags: new Set(config._nodes.flatMap(function (sn) { return sn.tags; })),
        children: config.children,
        historyValue: config.historyValue || {},
        matches: machineSnapshotMatches,
        hasTag: machineSnapshotHasTag,
        can: machineSnapshotCan,
        getMeta: machineSnapshotGetMeta,
        toJSON: machineSnapshotToJSON
    };
}
function cloneMachineSnapshot(snapshot, config) {
    if (config === void 0) { config = {}; }
    return createMachineSnapshot(__assign(__assign({}, snapshot), config), snapshot.machine);
}
function serializeHistoryValue(historyValue) {
    if (typeof historyValue !== "object" || historyValue === null) {
        return {};
    }
    var result = {};
    for (var key in historyValue) {
        var value = historyValue[key];
        if (Array.isArray(value)) {
            result[key] = value.map(function (item) { return ({
                id: item.id
            }); });
        }
    }
    return result;
}
function getPersistedSnapshot(snapshot, options) {
    var nodes = snapshot._nodes, tags = snapshot.tags, machine = snapshot.machine, children = snapshot.children, context = snapshot.context, can2 = snapshot.can, hasTag2 = snapshot.hasTag, matches2 = snapshot.matches, getMeta2 = snapshot.getMeta, toJSON2 = snapshot.toJSON, jsonValues = __rest(snapshot, ["_nodes", "tags", "machine", "children", "context", "can", "hasTag", "matches", "getMeta", "toJSON"]);
    var childrenJson = {};
    for (var id in children) {
        var child = children[id];
        childrenJson[id] = {
            snapshot: child.getPersistedSnapshot(options),
            src: child.src,
            systemId: child.systemId,
            syncSnapshot: child._syncSnapshot
        };
    }
    var persisted = __assign(__assign({}, jsonValues), { context: persistContext(context), children: childrenJson, historyValue: serializeHistoryValue(jsonValues.historyValue) });
    return persisted;
}
function persistContext(contextPart) {
    var copy;
    for (var key in contextPart) {
        var value = contextPart[key];
        if (value && typeof value === "object") {
            if ("sessionId" in value && "send" in value && "ref" in value) {
                copy !== null && copy !== void 0 ? copy : (copy = Array.isArray(contextPart) ? contextPart.slice() : __assign({}, contextPart));
                copy[key] = {
                    xstate$$type: $$ACTOR_TYPE,
                    id: value.id
                };
            }
            else {
                var result = persistContext(value);
                if (result !== value) {
                    copy !== null && copy !== void 0 ? copy : (copy = Array.isArray(contextPart) ? contextPart.slice() : __assign({}, contextPart));
                    copy[key] = result;
                }
            }
        }
    }
    return copy !== null && copy !== void 0 ? copy : contextPart;
}
function resolveRaise(_, snapshot, args, actionParams, _a, _b) {
    var eventOrExpr = _a.event, id = _a.id, delay = _a.delay;
    var internalQueue = _b.internalQueue;
    var delaysMap = snapshot.machine.implementations.delays;
    if (typeof eventOrExpr === "string") {
        throw new Error(
        // oxlint-disable-next-line typescript/restrict-template-expressions
        "Only event objects may be used with raise; use raise({ type: \"".concat(eventOrExpr, "\" }) instead"));
    }
    var resolvedEvent = typeof eventOrExpr === "function" ? eventOrExpr(args, actionParams) : eventOrExpr;
    var resolvedDelay;
    if (typeof delay === "string") {
        var configDelay = delaysMap && delaysMap[delay];
        resolvedDelay = typeof configDelay === "function" ? configDelay(args, actionParams) : configDelay;
    }
    else {
        resolvedDelay = typeof delay === "function" ? delay(args, actionParams) : delay;
    }
    if (typeof resolvedDelay !== "number") {
        internalQueue.push(resolvedEvent);
    }
    return [snapshot, {
            event: resolvedEvent,
            id: id,
            delay: resolvedDelay
        }, void 0];
}
function executeRaise(actorScope, params) {
    var event = params.event, delay = params.delay, id = params.id;
    if (typeof delay === "number") {
        actorScope.defer(function () {
            var self2 = actorScope.self;
            actorScope.system.scheduler.schedule(self2, self2, event, delay, id);
        });
        return;
    }
}
function raise(eventOrExpr, options) {
    function raise2(_args, _params) {
    }
    raise2.type = "xstate.raise";
    raise2.event = eventOrExpr;
    raise2.id = options === null || options === void 0 ? void 0 : options.id;
    raise2.delay = options === null || options === void 0 ? void 0 : options.delay;
    raise2.resolve = resolveRaise;
    raise2.execute = executeRaise;
    return raise2;
}
// node_modules/.pnpm/xstate@5.33.2/node_modules/xstate/dist/xstate-actors.esm.js
function fromTransition(transition2, initialContext) {
    return {
        config: transition2,
        transition: function (snapshot, event, actorScope) {
            return __assign(__assign({}, snapshot), { context: transition2(snapshot.context, event, actorScope) });
        },
        getInitialSnapshot: function (_, input) {
            return {
                status: "active",
                output: void 0,
                error: void 0,
                context: typeof initialContext === "function" ? initialContext({
                    input: input
                }) : initialContext
            };
        },
        getPersistedSnapshot: function (snapshot) { return snapshot; },
        restoreSnapshot: function (snapshot) { return snapshot; }
    };
}
var instanceStates = /* @__PURE__ */ new WeakMap();
function fromCallback(callback) {
    var logic = {
        config: callback,
        start: function (state, actorScope) {
            var self2 = actorScope.self, system = actorScope.system, emit2 = actorScope.emit;
            var callbackState = {
                receivers: void 0,
                dispose: void 0
            };
            instanceStates.set(self2, callbackState);
            callbackState.dispose = callback({
                input: state.input,
                system: system,
                self: self2,
                sendBack: function (event) {
                    if (self2.getSnapshot().status === "stopped") {
                        return;
                    }
                    if (self2._parent) {
                        system._relay(self2, self2._parent, event);
                    }
                },
                receive: function (listener) {
                    var _a;
                    (_a = callbackState.receivers) !== null && _a !== void 0 ? _a : (callbackState.receivers = /* @__PURE__ */ new Set());
                    callbackState.receivers.add(listener);
                },
                emit: emit2
            });
        },
        transition: function (state, event, actorScope) {
            var _a, _b, _c;
            var callbackState = instanceStates.get(actorScope.self);
            if (event.type === XSTATE_STOP) {
                state = __assign(__assign({}, state), { status: "stopped", error: void 0 });
                instanceStates.delete(actorScope.self);
                (_a = callbackState.receivers) === null || _a === void 0 ? void 0 : _a.clear();
                (_b = callbackState.dispose) === null || _b === void 0 ? void 0 : _b.call(callbackState);
                return state;
            }
            (_c = callbackState.receivers) === null || _c === void 0 ? void 0 : _c.forEach(function (receiver) { return receiver(event); });
            return state;
        },
        getInitialSnapshot: function (_, input) {
            return {
                status: "active",
                output: void 0,
                error: void 0,
                input: input
            };
        },
        getPersistedSnapshot: function (snapshot) { return snapshot; },
        restoreSnapshot: function (snapshot) { return snapshot; }
    };
    return logic;
}
var XSTATE_OBSERVABLE_NEXT = "xstate.observable.next";
var XSTATE_OBSERVABLE_ERROR = "xstate.observable.error";
var XSTATE_OBSERVABLE_COMPLETE = "xstate.observable.complete";
function fromObservable(observableCreator) {
    var logic = {
        config: observableCreator,
        transition: function (snapshot, event) {
            if (snapshot.status !== "active") {
                return snapshot;
            }
            switch (event.type) {
                case XSTATE_OBSERVABLE_NEXT: {
                    var newSnapshot = __assign(__assign({}, snapshot), { context: event.data });
                    return newSnapshot;
                }
                case XSTATE_OBSERVABLE_ERROR:
                    return __assign(__assign({}, snapshot), { status: "error", error: event.data, input: void 0, _subscription: void 0 });
                case XSTATE_OBSERVABLE_COMPLETE:
                    return __assign(__assign({}, snapshot), { status: "done", input: void 0, _subscription: void 0 });
                case XSTATE_STOP:
                    snapshot._subscription.unsubscribe();
                    return __assign(__assign({}, snapshot), { status: "stopped", input: void 0, _subscription: void 0 });
                default:
                    return snapshot;
            }
        },
        getInitialSnapshot: function (_, input) {
            return {
                status: "active",
                output: void 0,
                error: void 0,
                context: void 0,
                input: input,
                _subscription: void 0
            };
        },
        start: function (state, _a) {
            var self2 = _a.self, system = _a.system, emit2 = _a.emit;
            if (state.status === "done") {
                return;
            }
            state._subscription = observableCreator({
                input: state.input,
                system: system,
                self: self2,
                emit: emit2
            }).subscribe({
                next: function (value) {
                    system._relay(self2, self2, {
                        type: XSTATE_OBSERVABLE_NEXT,
                        data: value
                    });
                },
                error: function (err) {
                    system._relay(self2, self2, {
                        type: XSTATE_OBSERVABLE_ERROR,
                        data: err
                    });
                },
                complete: function () {
                    system._relay(self2, self2, {
                        type: XSTATE_OBSERVABLE_COMPLETE
                    });
                }
            });
        },
        getPersistedSnapshot: function (_a) {
            var _subscription = _a._subscription, state = __rest(_a, ["_subscription"]);
            return state;
        },
        restoreSnapshot: function (state) { return (__assign(__assign({}, state), { _subscription: void 0 })); }
    };
    return logic;
}
function fromEventObservable(lazyObservable) {
    var logic = {
        config: lazyObservable,
        transition: function (state, event) {
            if (state.status !== "active") {
                return state;
            }
            switch (event.type) {
                case XSTATE_OBSERVABLE_ERROR:
                    return __assign(__assign({}, state), { status: "error", error: event.data, input: void 0, _subscription: void 0 });
                case XSTATE_OBSERVABLE_COMPLETE:
                    return __assign(__assign({}, state), { status: "done", input: void 0, _subscription: void 0 });
                case XSTATE_STOP:
                    state._subscription.unsubscribe();
                    return __assign(__assign({}, state), { status: "stopped", input: void 0, _subscription: void 0 });
                default:
                    return state;
            }
        },
        getInitialSnapshot: function (_, input) {
            return {
                status: "active",
                output: void 0,
                error: void 0,
                context: void 0,
                input: input,
                _subscription: void 0
            };
        },
        start: function (state, _a) {
            var self2 = _a.self, system = _a.system, emit2 = _a.emit;
            if (state.status === "done") {
                return;
            }
            state._subscription = lazyObservable({
                input: state.input,
                system: system,
                self: self2,
                emit: emit2
            }).subscribe({
                next: function (value) {
                    if (self2._parent) {
                        system._relay(self2, self2._parent, value);
                    }
                },
                error: function (err) {
                    system._relay(self2, self2, {
                        type: XSTATE_OBSERVABLE_ERROR,
                        data: err
                    });
                },
                complete: function () {
                    system._relay(self2, self2, {
                        type: XSTATE_OBSERVABLE_COMPLETE
                    });
                }
            });
        },
        getPersistedSnapshot: function (_a) {
            var _subscription = _a._subscription, snapshot = __rest(_a, ["_subscription"]);
            return snapshot;
        },
        restoreSnapshot: function (snapshot) { return (__assign(__assign({}, snapshot), { _subscription: void 0 })); }
    };
    return logic;
}
var XSTATE_PROMISE_RESOLVE = "xstate.promise.resolve";
var XSTATE_PROMISE_REJECT = "xstate.promise.reject";
var controllerMap = /* @__PURE__ */ new WeakMap();
function fromPromise(promiseCreator) {
    var logic = {
        config: promiseCreator,
        transition: function (state, event, scope) {
            var _a;
            if (state.status !== "active") {
                return state;
            }
            switch (event.type) {
                case XSTATE_PROMISE_RESOLVE: {
                    var resolvedValue = event.data;
                    return __assign(__assign({}, state), { status: "done", output: resolvedValue, input: void 0 });
                }
                case XSTATE_PROMISE_REJECT:
                    return __assign(__assign({}, state), { status: "error", error: event.data, input: void 0 });
                case XSTATE_STOP: {
                    (_a = controllerMap.get(scope.self)) === null || _a === void 0 ? void 0 : _a.abort();
                    controllerMap.delete(scope.self);
                    return __assign(__assign({}, state), { status: "stopped", input: void 0 });
                }
                default:
                    return state;
            }
        },
        start: function (state, _a) {
            var self2 = _a.self, system = _a.system, emit2 = _a.emit;
            if (state.status !== "active") {
                return;
            }
            var controller = new AbortController();
            controllerMap.set(self2, controller);
            var resolvedPromise = Promise.resolve(promiseCreator({
                input: state.input,
                system: system,
                self: self2,
                signal: controller.signal,
                emit: emit2
            }));
            resolvedPromise.then(function (response) {
                if (self2.getSnapshot().status !== "active") {
                    return;
                }
                controllerMap.delete(self2);
                system._relay(self2, self2, {
                    type: XSTATE_PROMISE_RESOLVE,
                    data: response
                });
            }, function (errorData) {
                if (self2.getSnapshot().status !== "active") {
                    return;
                }
                controllerMap.delete(self2);
                system._relay(self2, self2, {
                    type: XSTATE_PROMISE_REJECT,
                    data: errorData
                });
            });
        },
        getInitialSnapshot: function (_, input) {
            return {
                status: "active",
                output: void 0,
                error: void 0,
                input: input
            };
        },
        getPersistedSnapshot: function (snapshot) { return snapshot; },
        restoreSnapshot: function (snapshot) { return snapshot; }
    };
    return logic;
}
var emptyLogic = fromTransition(function (_) { return void 0; }, void 0);
function createEmptyActor() {
    return createActor(emptyLogic);
}
// node_modules/.pnpm/xstate@5.33.2/node_modules/xstate/dist/assign-b4b1f28f.esm.js
function createSpawner(actorScope, _a, event, spawnedChildren) {
    var machine = _a.machine, context = _a.context;
    var spawn = function (src, options) {
        if (typeof src === "string") {
            var logic = resolveReferencedActor(machine, src);
            if (!logic) {
                throw new Error("Actor logic '".concat(src, "' not implemented in machine '").concat(machine.id, "'"));
            }
            var actorRef = createActor(logic, {
                id: options === null || options === void 0 ? void 0 : options.id,
                parent: actorScope.self,
                syncSnapshot: options === null || options === void 0 ? void 0 : options.syncSnapshot,
                input: typeof (options === null || options === void 0 ? void 0 : options.input) === "function" ? options.input({
                    context: context,
                    event: event,
                    self: actorScope.self
                }) : options === null || options === void 0 ? void 0 : options.input,
                src: src,
                systemId: options === null || options === void 0 ? void 0 : options.systemId
            });
            spawnedChildren[actorRef.id] = actorRef;
            return actorRef;
        }
        else {
            var actorRef = createActor(src, {
                id: options === null || options === void 0 ? void 0 : options.id,
                parent: actorScope.self,
                syncSnapshot: options === null || options === void 0 ? void 0 : options.syncSnapshot,
                input: options === null || options === void 0 ? void 0 : options.input,
                src: src,
                systemId: options === null || options === void 0 ? void 0 : options.systemId
            });
            return actorRef;
        }
    };
    return function (src, options) {
        var actorRef = spawn(src, options);
        spawnedChildren[actorRef.id] = actorRef;
        actorScope.defer(function () {
            if (actorRef._processingStatus === ProcessingStatus.Stopped) {
                return;
            }
            actorRef.start();
        });
        return actorRef;
    };
}
function resolveAssign(actorScope, snapshot, actionArgs, actionParams, _a) {
    var e_51, _b;
    var assignment = _a.assignment;
    if (!snapshot.context) {
        throw new Error("Cannot assign to undefined `context`. Ensure that `context` is defined in the machine config.");
    }
    var spawnedChildren = {};
    var assignArgs = {
        context: snapshot.context,
        event: actionArgs.event,
        spawn: createSpawner(actorScope, snapshot, actionArgs.event, spawnedChildren),
        self: actorScope.self,
        system: actorScope.system
    };
    var partialUpdate = {};
    if (typeof assignment === "function") {
        partialUpdate = assignment(assignArgs, actionParams);
    }
    else {
        try {
            for (var _c = __values(Object.keys(assignment)), _d = _c.next(); !_d.done; _d = _c.next()) {
                var key = _d.value;
                var propAssignment = assignment[key];
                partialUpdate[key] = typeof propAssignment === "function" ? propAssignment(assignArgs, actionParams) : propAssignment;
            }
        }
        catch (e_51_1) { e_51 = { error: e_51_1 }; }
        finally {
            try {
                if (_d && !_d.done && (_b = _c.return)) _b.call(_c);
            }
            finally { if (e_51) throw e_51.error; }
        }
    }
    var updatedContext = Object.assign({}, snapshot.context, partialUpdate);
    return [cloneMachineSnapshot(snapshot, {
            context: updatedContext,
            children: Object.keys(spawnedChildren).length ? __assign(__assign({}, snapshot.children), spawnedChildren) : snapshot.children
        }), void 0, void 0];
}
function assign(assignment) {
    function assign2(_args, _params) {
    }
    assign2.type = "xstate.assign";
    assign2.assignment = assignment;
    assign2.resolve = resolveAssign;
    return assign2;
}
// node_modules/.pnpm/xstate@5.33.2/node_modules/xstate/dist/StateMachine-521e1f66.esm.js
var cache = /* @__PURE__ */ new WeakMap();
function memo(object, key, fn) {
    var _a;
    var memoizedData = cache.get(object);
    if (!memoizedData) {
        memoizedData = (_a = {},
            _a[key] = fn(),
            _a);
        cache.set(object, memoizedData);
    }
    else if (!(key in memoizedData)) {
        memoizedData[key] = fn();
    }
    return memoizedData[key];
}
var EMPTY_OBJECT = {};
var toSerializableAction = function (action) {
    if (typeof action === "string") {
        return {
            type: action
        };
    }
    if (typeof action === "function") {
        if ("resolve" in action) {
            return {
                type: action.type
            };
        }
        return {
            type: action.name
        };
    }
    return action;
};
var StateNode = /** @class */ (function () {
    function _StateNode(config, options) {
        var _this = this;
        this.config = config;
        this.key = void 0;
        this.id = void 0;
        this.type = void 0;
        this.path = void 0;
        this.states = void 0;
        this.history = void 0;
        this.entry = void 0;
        this.exit = void 0;
        this.parent = void 0;
        this.machine = void 0;
        this.meta = void 0;
        this.output = void 0;
        this.order = -1;
        this.description = void 0;
        this.tags = [];
        this.transitions = void 0;
        this.always = void 0;
        this.parent = options._parent;
        this.key = options._key;
        this.machine = options._machine;
        this.path = this.parent ? this.parent.path.concat(this.key) : [];
        this.id = this.config.id || __spreadArray([this.machine.id], __read(this.path), false).join(STATE_DELIMITER);
        this.type = this.config.type || (this.config.states && Object.keys(this.config.states).length ? "compound" : this.config.history ? "history" : "atomic");
        this.description = this.config.description;
        this.order = this.machine.idMap.size;
        this.machine.idMap.set(this.id, this);
        this.states = this.config.states ? mapValues(this.config.states, function (stateConfig, key) {
            var stateNode = new _StateNode(stateConfig, {
                _parent: _this,
                _key: key,
                _machine: _this.machine
            });
            return stateNode;
        }) : EMPTY_OBJECT;
        if (this.type === "compound" && !this.config.initial) {
            throw new Error("No initial state specified for compound state node \"#".concat(this.id, "\". Try adding { initial: \"").concat(Object.keys(this.states)[0], "\" } to the state config."));
        }
        this.history = this.config.history === true ? "shallow" : this.config.history || false;
        this.entry = toArray(this.config.entry).slice();
        this.exit = toArray(this.config.exit).slice();
        this.meta = this.config.meta;
        this.output = this.type === "final" || !this.parent ? this.config.output : void 0;
        this.tags = toArray(config.tags).slice();
    }
    /** @internal */
    _StateNode.prototype._initialize = function () {
        var _this = this;
        this.transitions = formatTransitions(this);
        if (this.config.always) {
            this.always = toTransitionConfigArray(this.config.always).map(function (t) { return formatTransition(_this, NULL_EVENT, t); });
        }
        Object.keys(this.states).forEach(function (key) {
            _this.states[key]._initialize();
        });
    };
    Object.defineProperty(_StateNode.prototype, "definition", {
        /** The well-structured state node definition. */
        get: function () {
            var _this = this;
            return {
                id: this.id,
                key: this.key,
                version: this.machine.version,
                type: this.type,
                initial: this.initial ? {
                    target: this.initial.target,
                    source: this,
                    actions: this.initial.actions.map(toSerializableAction),
                    eventType: null,
                    reenter: false,
                    meta: this.initial.meta,
                    description: this.initial.description,
                    toJSON: function () { return ({
                        target: _this.initial.target.map(function (t) { return "#".concat(t.id); }),
                        source: "#".concat(_this.id),
                        actions: _this.initial.actions.map(toSerializableAction),
                        eventType: null,
                        meta: _this.initial.meta,
                        description: _this.initial.description
                    }); }
                } : void 0,
                history: this.history,
                states: mapValues(this.states, function (state) { return state.definition; }),
                on: this.on,
                transitions: __spreadArray([], __read(this.transitions.values()), false).flat().map(function (t) { return (__assign(__assign({}, t), { actions: t.actions.map(toSerializableAction) })); }),
                entry: this.entry.map(toSerializableAction),
                exit: this.exit.map(toSerializableAction),
                meta: this.meta,
                order: this.order || -1,
                output: this.output,
                invoke: this.invoke,
                description: this.description,
                tags: this.tags
            };
        },
        enumerable: false,
        configurable: true
    });
    /** @internal */
    _StateNode.prototype.toJSON = function () {
        return this.definition;
    };
    Object.defineProperty(_StateNode.prototype, "invoke", {
        /** The logic invoked as actors by this state node. */
        get: function () {
            var _this = this;
            return memo(this, "invoke", function () { return toArray(_this.config.invoke).map(function (invokeConfig, i) {
                var _a;
                var src = invokeConfig.src, systemId = invokeConfig.systemId;
                var resolvedId = (_a = invokeConfig.id) !== null && _a !== void 0 ? _a : createInvokeId(_this.id, i);
                var sourceName = typeof src === "string" ? src : "xstate.invoke.".concat(createInvokeId(_this.id, i));
                return __assign(__assign({}, invokeConfig), { src: sourceName, id: resolvedId, systemId: systemId, toJSON: function () {
                        var onDone = invokeConfig.onDone, onError = invokeConfig.onError, invokeDefValues = __rest(invokeConfig, ["onDone", "onError"]);
                        return __assign(__assign({}, invokeDefValues), { type: "xstate.invoke", src: sourceName, id: resolvedId });
                    } });
            }); });
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(_StateNode.prototype, "on", {
        /** The mapping of events to transitions. */
        get: function () {
            var _this = this;
            return memo(this, "on", function () {
                var transitions = _this.transitions;
                return __spreadArray([], __read(transitions), false).flatMap(function (_a) {
                    var _b = __read(_a, 2), descriptor = _b[0], t = _b[1];
                    return t.map(function (t2) { return [descriptor, t2]; });
                }).reduce(function (map, _a) {
                    var _b = __read(_a, 2), descriptor = _b[0], transition2 = _b[1];
                    map[descriptor] = map[descriptor] || [];
                    map[descriptor].push(transition2);
                    return map;
                }, {});
            });
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(_StateNode.prototype, "after", {
        get: function () {
            var _this = this;
            return memo(this, "delayedTransitions", function () { return getDelayedTransitions(_this); });
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(_StateNode.prototype, "initial", {
        get: function () {
            var _this = this;
            return memo(this, "initial", function () { return formatInitialTransition(_this, _this.config.initial); });
        },
        enumerable: false,
        configurable: true
    });
    /** @internal */
    _StateNode.prototype.next = function (snapshot, event) {
        var e_52, _a;
        var _this = this;
        var eventType = event.type;
        var actions = [];
        var selectedTransition;
        var candidates = memo(this, "candidates-".concat(eventType), function () { return getCandidates(_this, eventType); });
        try {
            for (var candidates_1 = __values(candidates), candidates_1_1 = candidates_1.next(); !candidates_1_1.done; candidates_1_1 = candidates_1.next()) {
                var candidate = candidates_1_1.value;
                var guard = candidate.guard;
                var resolvedContext = snapshot.context;
                var guardPassed = false;
                try {
                    guardPassed = !guard || evaluateGuard(guard, resolvedContext, event, snapshot);
                }
                catch (err) {
                    var guardType = typeof guard === "string" ? guard : typeof guard === "object" ? guard.type : void 0;
                    throw new Error("Unable to evaluate guard ".concat(guardType ? "'".concat(guardType, "' ") : "", "in transition for event '").concat(eventType, "' in state node '").concat(this.id, "':\n").concat(err.message));
                }
                if (guardPassed) {
                    actions.push.apply(actions, __spreadArray([], __read(candidate.actions), false));
                    selectedTransition = candidate;
                    break;
                }
            }
        }
        catch (e_52_1) { e_52 = { error: e_52_1 }; }
        finally {
            try {
                if (candidates_1_1 && !candidates_1_1.done && (_a = candidates_1.return)) _a.call(candidates_1);
            }
            finally { if (e_52) throw e_52.error; }
        }
        return selectedTransition ? [selectedTransition] : void 0;
    };
    Object.defineProperty(_StateNode.prototype, "events", {
        /** All the event types accepted by this state node and its descendants. */
        get: function () {
            var _this = this;
            return memo(this, "events", function () {
                var e_53, _a, e_54, _b;
                var states = _this.states;
                var events = new Set(_this.ownEvents);
                if (states) {
                    try {
                        for (var _c = __values(Object.keys(states)), _d = _c.next(); !_d.done; _d = _c.next()) {
                            var stateId = _d.value;
                            var state = states[stateId];
                            if (state.states) {
                                try {
                                    for (var _e = (e_54 = void 0, __values(state.events)), _f = _e.next(); !_f.done; _f = _e.next()) {
                                        var event_2 = _f.value;
                                        events.add("".concat(event_2));
                                    }
                                }
                                catch (e_54_1) { e_54 = { error: e_54_1 }; }
                                finally {
                                    try {
                                        if (_f && !_f.done && (_b = _e.return)) _b.call(_e);
                                    }
                                    finally { if (e_54) throw e_54.error; }
                                }
                            }
                        }
                    }
                    catch (e_53_1) { e_53 = { error: e_53_1 }; }
                    finally {
                        try {
                            if (_d && !_d.done && (_a = _c.return)) _a.call(_c);
                        }
                        finally { if (e_53) throw e_53.error; }
                    }
                }
                return Array.from(events);
            });
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(_StateNode.prototype, "ownEvents", {
        /**
         * All the events that have transitions directly from this state node.
         *
         * Excludes any inert events.
         */
        get: function () {
            var _this = this;
            var keys = Object.keys(Object.fromEntries(this.transitions));
            var events = new Set(keys.filter(function (descriptor) {
                return _this.transitions.get(descriptor).some(function (transition2) { return !(!transition2.target && !transition2.actions.length && !transition2.reenter); });
            }));
            return Array.from(events);
        },
        enumerable: false,
        configurable: true
    });
    return _StateNode;
}());
var STATE_IDENTIFIER2 = "#";
var StateMachine = /** @class */ (function () {
    function _StateMachine(config, implementations) {
        var _a, _b, _c, _d;
        this.config = config;
        this.version = void 0;
        this.schemas = void 0;
        this.implementations = void 0;
        this.options = void 0;
        this.__xstatenode = true;
        this.idMap = /* @__PURE__ */ new Map();
        this.root = void 0;
        this.id = void 0;
        this.states = void 0;
        this.events = void 0;
        this.id = config.id || "(machine)";
        this.implementations = {
            actors: (_a = implementations === null || implementations === void 0 ? void 0 : implementations.actors) !== null && _a !== void 0 ? _a : {},
            actions: (_b = implementations === null || implementations === void 0 ? void 0 : implementations.actions) !== null && _b !== void 0 ? _b : {},
            delays: (_c = implementations === null || implementations === void 0 ? void 0 : implementations.delays) !== null && _c !== void 0 ? _c : {},
            guards: (_d = implementations === null || implementations === void 0 ? void 0 : implementations.guards) !== null && _d !== void 0 ? _d : {}
        };
        this.version = this.config.version;
        this.schemas = this.config.schemas;
        this.options = __assign({ maxIterations: Infinity }, this.config.options);
        this.transition = this.transition.bind(this);
        this.getInitialSnapshot = this.getInitialSnapshot.bind(this);
        this.getPersistedSnapshot = this.getPersistedSnapshot.bind(this);
        this.restoreSnapshot = this.restoreSnapshot.bind(this);
        this.start = this.start.bind(this);
        this.root = new StateNode(config, {
            _key: this.id,
            _machine: this
        });
        this.root._initialize();
        formatRouteTransitions(this.root);
        this.states = this.root.states;
        this.events = this.root.events;
    }
    /**
     * Clones this state machine with the provided implementations.
     *
     * @param implementations Options (`actions`, `guards`, `actors`, `delays`) to
     *   recursively merge with the existing options.
     * @returns A new `StateMachine` instance with the provided implementations.
     */
    _StateMachine.prototype.provide = function (implementations) {
        var _a = this.implementations, actions = _a.actions, guards = _a.guards, actors = _a.actors, delays = _a.delays;
        return new _StateMachine(this.config, {
            actions: __assign(__assign({}, actions), implementations.actions),
            guards: __assign(__assign({}, guards), implementations.guards),
            actors: __assign(__assign({}, actors), implementations.actors),
            delays: __assign(__assign({}, delays), implementations.delays)
        });
    };
    _StateMachine.prototype.resolveState = function (config) {
        var resolvedStateValue = resolveStateValue(this.root, config.value);
        var nodeSet = getAllStateNodes(getStateNodes(this.root, resolvedStateValue));
        return createMachineSnapshot({
            _nodes: __spreadArray([], __read(nodeSet), false),
            context: config.context || {},
            children: {},
            status: isInFinalState(nodeSet, this.root) ? "done" : config.status || "active",
            output: config.output,
            error: config.error,
            historyValue: config.historyValue
        }, this);
    };
    /**
     * Determines the next snapshot given the current `snapshot` and received
     * `event`. Calculates a full macrostep from all microsteps.
     *
     * @param snapshot The current snapshot
     * @param event The received event
     */
    _StateMachine.prototype.transition = function (snapshot, event, actorScope) {
        return macrostep(snapshot, event, actorScope, []).snapshot;
    };
    /**
     * Determines the next state given the current `state` and `event`. Calculates
     * a microstep.
     *
     * @param state The current state
     * @param event The received event
     */
    _StateMachine.prototype.microstep = function (snapshot, event, actorScope) {
        return macrostep(snapshot, event, actorScope, []).microsteps.map(function (_a) {
            var _b = __read(_a, 1), s = _b[0];
            return s;
        });
    };
    _StateMachine.prototype.getTransitionData = function (snapshot, event) {
        return transitionNode(this.root, snapshot.value, snapshot, event) || [];
    };
    /**
     * The initial state _before_ evaluating any microsteps. This "pre-initial"
     * state is provided to initial actions executed in the initial state.
     *
     * @internal
     */
    _StateMachine.prototype._getPreInitialState = function (actorScope, initEvent, internalQueue) {
        var context = this.config.context;
        var preInitial = createMachineSnapshot({
            context: typeof context !== "function" && context ? context : {},
            _nodes: [this.root],
            children: {},
            status: "active"
        }, this);
        if (typeof context === "function") {
            var assignment = function (_a) {
                var spawn = _a.spawn, event = _a.event, self2 = _a.self;
                return context({
                    spawn: spawn,
                    input: event.input,
                    self: self2
                });
            };
            return resolveActionsAndContext(preInitial, initEvent, actorScope, [assign(assignment)], internalQueue, void 0);
        }
        return preInitial;
    };
    /**
     * Returns the initial `State` instance, with reference to `self` as an
     * `ActorRef`.
     */
    _StateMachine.prototype.getInitialSnapshot = function (actorScope, input) {
        var initEvent = createInitEvent(input);
        var internalQueue = [];
        var snapshot = createMachineSnapshot({
            context: typeof this.config.context !== "function" && this.config.context ? this.config.context : {},
            _nodes: [this.root],
            children: {},
            status: "active"
        }, this);
        try {
            snapshot = this._getPreInitialState(actorScope, initEvent, internalQueue);
            var _a = __read(initialMicrostep(this.root, snapshot, actorScope, initEvent, internalQueue), 1), nextState = _a[0];
            var macroState = macrostep(nextState, initEvent, actorScope, internalQueue).snapshot;
            return macroState;
        }
        catch (error) {
            return cloneMachineSnapshot(snapshot, {
                status: "error",
                error: error
            });
        }
    };
    _StateMachine.prototype.start = function (snapshot) {
        Object.values(snapshot.children).forEach(function (child) {
            if (child.getSnapshot().status === "active") {
                child.start();
            }
        });
    };
    _StateMachine.prototype.getStateNodeById = function (stateId) {
        var fullPath = toStatePath(stateId);
        var relativePath = fullPath.slice(1);
        var resolvedStateId = isStateId(fullPath[0]) ? fullPath[0].slice(STATE_IDENTIFIER2.length) : fullPath[0];
        var stateNode = this.idMap.get(resolvedStateId);
        if (!stateNode) {
            throw new Error("Child state node '#".concat(resolvedStateId, "' does not exist on machine '").concat(this.id, "'"));
        }
        return getStateNodeByPath(stateNode, relativePath);
    };
    Object.defineProperty(_StateMachine.prototype, "definition", {
        get: function () {
            return this.root.definition;
        },
        enumerable: false,
        configurable: true
    });
    _StateMachine.prototype.toJSON = function () {
        return this.definition;
    };
    _StateMachine.prototype.getPersistedSnapshot = function (snapshot, options) {
        return getPersistedSnapshot(snapshot, options);
    };
    _StateMachine.prototype.restoreSnapshot = function (snapshot, _actorScope) {
        var _this = this;
        var children = {};
        var snapshotChildren = snapshot.children;
        Object.keys(snapshotChildren).forEach(function (actorId) {
            var actorData = snapshotChildren[actorId];
            var childState = actorData.snapshot;
            var src = actorData.src;
            var logic = typeof src === "string" ? resolveReferencedActor(_this, src) : src;
            if (!logic) {
                return;
            }
            var actorRef = createActor(logic, {
                id: actorId,
                parent: _actorScope.self,
                syncSnapshot: actorData.syncSnapshot,
                snapshot: childState,
                src: src,
                systemId: actorData.systemId
            });
            children[actorId] = actorRef;
        });
        function resolveHistoryReferencedState(root, referenced) {
            if (referenced instanceof StateNode) {
                return referenced;
            }
            try {
                return root.machine.getStateNodeById(referenced.id);
            }
            catch (_a) {
            }
        }
        function reviveHistoryValue(root, historyValue) {
            var e_55, _a;
            var _b;
            if (!historyValue || typeof historyValue !== "object") {
                return {};
            }
            var revived = {};
            for (var key in historyValue) {
                var arr = historyValue[key];
                try {
                    for (var arr_1 = (e_55 = void 0, __values(arr)), arr_1_1 = arr_1.next(); !arr_1_1.done; arr_1_1 = arr_1.next()) {
                        var item = arr_1_1.value;
                        var resolved = resolveHistoryReferencedState(root, item);
                        if (!resolved) {
                            continue;
                        }
                        (_b = revived[key]) !== null && _b !== void 0 ? _b : (revived[key] = []);
                        revived[key].push(resolved);
                    }
                }
                catch (e_55_1) { e_55 = { error: e_55_1 }; }
                finally {
                    try {
                        if (arr_1_1 && !arr_1_1.done && (_a = arr_1.return)) _a.call(arr_1);
                    }
                    finally { if (e_55) throw e_55.error; }
                }
            }
            return revived;
        }
        var revivedHistoryValue = reviveHistoryValue(this.root, snapshot.historyValue);
        var restoredSnapshot = createMachineSnapshot(__assign(__assign({}, snapshot), { children: children, _nodes: Array.from(getAllStateNodes(getStateNodes(this.root, snapshot.value))), historyValue: revivedHistoryValue }), this);
        var seen = /* @__PURE__ */ new Set();
        function reviveContext(contextPart, children2) {
            if (seen.has(contextPart)) {
                return;
            }
            seen.add(contextPart);
            for (var key in contextPart) {
                var value = contextPart[key];
                if (value && typeof value === "object") {
                    if ("xstate$$type" in value && value.xstate$$type === $$ACTOR_TYPE) {
                        contextPart[key] = children2[value.id];
                        continue;
                    }
                    reviveContext(value, children2);
                }
            }
        }
        reviveContext(restoredSnapshot.context, children);
        return restoredSnapshot;
    };
    return _StateMachine;
}());
// node_modules/.pnpm/xstate@5.33.2/node_modules/xstate/dist/log-ddf17a4a.esm.js
function resolveEmit(_, snapshot, args, actionParams, _a) {
    var eventOrExpr = _a.event;
    var resolvedEvent = typeof eventOrExpr === "function" ? eventOrExpr(args, actionParams) : eventOrExpr;
    return [snapshot, {
            event: resolvedEvent
        }, void 0];
}
function executeEmit(actorScope, _a) {
    var event = _a.event;
    actorScope.defer(function () { return actorScope.emit(event); });
}
function emit(eventOrExpr) {
    function emit2(_args, _params) {
    }
    emit2.type = "xstate.emit";
    emit2.event = eventOrExpr;
    emit2.resolve = resolveEmit;
    emit2.execute = executeEmit;
    return emit2;
}
var SpecialTargets = /* @__PURE__ */ (function (SpecialTargets2) {
    SpecialTargets2["Parent"] = "#_parent";
    SpecialTargets2["Internal"] = "#_internal";
    return SpecialTargets2;
})({});
function resolveSendTo(actorScope, snapshot, args, actionParams, _a, extra) {
    var _b;
    var to = _a.to, eventOrExpr = _a.event, id = _a.id, delay = _a.delay;
    var delaysMap = snapshot.machine.implementations.delays;
    if (typeof eventOrExpr === "string") {
        throw new Error(
        // oxlint-disable-next-line typescript/restrict-template-expressions
        "Only event objects may be used with sendTo; use sendTo({ type: \"".concat(eventOrExpr, "\" }) instead"));
    }
    var resolvedEvent = typeof eventOrExpr === "function" ? eventOrExpr(args, actionParams) : eventOrExpr;
    var resolvedDelay;
    if (typeof delay === "string") {
        var configDelay = delaysMap && delaysMap[delay];
        resolvedDelay = typeof configDelay === "function" ? configDelay(args, actionParams) : configDelay;
    }
    else {
        resolvedDelay = typeof delay === "function" ? delay(args, actionParams) : delay;
    }
    var resolvedTarget = typeof to === "function" ? to(args, actionParams) : to;
    var targetActorRef;
    if (typeof resolvedTarget === "string") {
        if (resolvedTarget === SpecialTargets.Parent) {
            targetActorRef = actorScope.self._parent;
        }
        else if (resolvedTarget === SpecialTargets.Internal) {
            targetActorRef = actorScope.self;
        }
        else if (resolvedTarget.startsWith("#_")) {
            targetActorRef = snapshot.children[resolvedTarget.slice(2)];
        }
        else {
            targetActorRef = ((_b = extra.deferredActorIds) === null || _b === void 0 ? void 0 : _b.includes(resolvedTarget)) ? resolvedTarget : snapshot.children[resolvedTarget];
        }
        if (!targetActorRef) {
            throw new Error("Unable to send event to actor '".concat(resolvedTarget, "' from machine '").concat(snapshot.machine.id, "'."));
        }
    }
    else {
        targetActorRef = resolvedTarget || actorScope.self;
    }
    return [snapshot, {
            to: targetActorRef,
            targetId: typeof resolvedTarget === "string" ? resolvedTarget : void 0,
            event: resolvedEvent,
            id: id,
            delay: resolvedDelay
        }, void 0];
}
function retryResolveSendTo(_, snapshot, params) {
    if (typeof params.to === "string") {
        params.to = snapshot.children[params.to];
    }
}
function executeSendTo(actorScope, params) {
    actorScope.defer(function () {
        var to = params.to, event = params.event, delay = params.delay, id = params.id;
        if (typeof delay === "number") {
            actorScope.system.scheduler.schedule(actorScope.self, to, event, delay, id);
            return;
        }
        actorScope.system._relay(actorScope.self, 
        // at this point, in a deferred task, it should already be mutated by retryResolveSendTo
        // if it initially started as a string
        to, event.type === XSTATE_ERROR ? createErrorActorEvent(actorScope.self.id, event.data) : event);
    });
}
function sendTo(to, eventOrExpr, options) {
    function sendTo2(_args, _params) {
    }
    sendTo2.type = "xstate.sendTo";
    sendTo2.to = to;
    sendTo2.event = eventOrExpr;
    sendTo2.id = options === null || options === void 0 ? void 0 : options.id;
    sendTo2.delay = options === null || options === void 0 ? void 0 : options.delay;
    sendTo2.resolve = resolveSendTo;
    sendTo2.retryResolve = retryResolveSendTo;
    sendTo2.execute = executeSendTo;
    return sendTo2;
}
function sendParent(event, options) {
    return sendTo(SpecialTargets.Parent, event, options);
}
function forwardTo(target, options) {
    return sendTo(target, function (_a) {
        var event = _a.event;
        return event;
    }, options);
}
function resolveEnqueueActions(actorScope, snapshot, args, actionParams, _a) {
    var collect = _a.collect;
    var actions = [];
    var enqueue = function enqueue2(action) {
        actions.push(action);
    };
    enqueue.assign = function () {
        var args2 = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args2[_i] = arguments[_i];
        }
        actions.push(assign.apply(void 0, __spreadArray([], __read(args2), false)));
    };
    enqueue.cancel = function () {
        var args2 = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args2[_i] = arguments[_i];
        }
        actions.push(cancel.apply(void 0, __spreadArray([], __read(args2), false)));
    };
    enqueue.raise = function () {
        var args2 = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args2[_i] = arguments[_i];
        }
        actions.push(raise.apply(void 0, __spreadArray([], __read(args2), false)));
    };
    enqueue.sendTo = function () {
        var args2 = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args2[_i] = arguments[_i];
        }
        actions.push(sendTo.apply(void 0, __spreadArray([], __read(args2), false)));
    };
    enqueue.sendParent = function () {
        var args2 = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args2[_i] = arguments[_i];
        }
        actions.push(sendParent.apply(void 0, __spreadArray([], __read(args2), false)));
    };
    enqueue.spawnChild = function () {
        var args2 = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args2[_i] = arguments[_i];
        }
        actions.push(spawnChild.apply(void 0, __spreadArray([], __read(args2), false)));
    };
    enqueue.stopChild = function () {
        var args2 = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args2[_i] = arguments[_i];
        }
        actions.push(stopChild.apply(void 0, __spreadArray([], __read(args2), false)));
    };
    enqueue.emit = function () {
        var args2 = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args2[_i] = arguments[_i];
        }
        actions.push(emit.apply(void 0, __spreadArray([], __read(args2), false)));
    };
    collect({
        context: args.context,
        event: args.event,
        enqueue: enqueue,
        check: function (guard) { return evaluateGuard(guard, snapshot.context, args.event, snapshot); },
        self: actorScope.self,
        system: actorScope.system
    }, actionParams);
    return [snapshot, void 0, actions];
}
function enqueueActions(collect) {
    function enqueueActions2(_args, _params) {
    }
    enqueueActions2.type = "xstate.enqueueActions";
    enqueueActions2.collect = collect;
    enqueueActions2.resolve = resolveEnqueueActions;
    return enqueueActions2;
}
function resolveLog(_, snapshot, actionArgs, actionParams, _a) {
    var value = _a.value, label = _a.label;
    return [snapshot, {
            value: typeof value === "function" ? value(actionArgs, actionParams) : value,
            label: label
        }, void 0];
}
function executeLog(_a, _b) {
    var logger = _a.logger;
    var value = _b.value, label = _b.label;
    if (label) {
        logger(label, value);
    }
    else {
        logger(value);
    }
}
function log(value, label) {
    if (value === void 0) { value = function (_a) {
        var context = _a.context, event = _a.event;
        return ({
            context: context,
            event: event
        });
    }; }
    function log2(_args, _params) {
    }
    log2.type = "xstate.log";
    log2.value = value;
    log2.label = label;
    log2.resolve = resolveLog;
    log2.execute = executeLog;
    return log2;
}
// node_modules/.pnpm/xstate@5.33.2/node_modules/xstate/dist/xstate.esm.js
function assertEvent(event, type) {
    var types = toArray(type);
    var matches2 = types.some(function (descriptor) { return matchesEventDescriptor(event.type, descriptor); });
    if (!matches2) {
        var typesText = types.length === 1 ? "type matching \"".concat(types[0], "\"") : "one of types matching \"".concat(types.join('", "'), "\"");
        throw new Error("Expected event ".concat(JSON.stringify(event), " to have ").concat(typesText));
    }
}
function createMachine(config, implementations) {
    return new StateMachine(config, implementations);
}
function mapState(snapshot, mapper) {
    var e_56, _a;
    var results = [];
    var findMapper = function (currentMapper, nodePath) {
        var e_57, _a;
        var mapper2 = currentMapper;
        try {
            for (var nodePath_1 = __values(nodePath), nodePath_1_1 = nodePath_1.next(); !nodePath_1_1.done; nodePath_1_1 = nodePath_1.next()) {
                var key = nodePath_1_1.value;
                if (!(mapper2 === null || mapper2 === void 0 ? void 0 : mapper2.states)) {
                    return void 0;
                }
                var states = mapper2.states;
                if (!(key in states)) {
                    return void 0;
                }
                mapper2 = states[key];
            }
        }
        catch (e_57_1) { e_57 = { error: e_57_1 }; }
        finally {
            try {
                if (nodePath_1_1 && !nodePath_1_1.done && (_a = nodePath_1.return)) _a.call(nodePath_1);
            }
            finally { if (e_57) throw e_57.error; }
        }
        return mapper2;
    };
    var visited = /* @__PURE__ */ new Set();
    try {
        for (var _b = __values(snapshot._nodes.filter(isAtomicStateNode)), _c = _b.next(); !_c.done; _c = _b.next()) {
            var atomicNode = _c.value;
            var current = atomicNode;
            while (current && !visited.has(current)) {
                visited.add(current);
                var nodeMapper = findMapper(mapper, current.path);
                if (nodeMapper === null || nodeMapper === void 0 ? void 0 : nodeMapper.map) {
                    results.push({
                        stateNode: current,
                        result: nodeMapper.map(snapshot)
                    });
                }
                current = current.parent;
            }
        }
    }
    catch (e_56_1) { e_56 = { error: e_56_1 }; }
    finally {
        try {
            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
        }
        finally { if (e_56) throw e_56.error; }
    }
    return results;
}
function createInertActorScope(actorLogic) {
    var self2 = createActor(actorLogic);
    var freshSystem = createSystem(self2, {
        clock: self2.system._clock,
        logger: self2.system._logger
    });
    self2.system = freshSystem;
    var inertActorScope = {
        self: self2,
        defer: function () {
        },
        id: "",
        logger: function () {
        },
        sessionId: "",
        stopChild: function () {
        },
        system: freshSystem,
        emit: function () {
        },
        actionExecutor: function () {
        }
    };
    return inertActorScope;
}
function getInitialSnapshot(actorLogic) {
    var _a = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        _a[_i - 1] = arguments[_i];
    }
    var _b = __read(_a, 1), input = _b[0];
    var actorScope = createInertActorScope(actorLogic);
    return actorLogic.getInitialSnapshot(actorScope, input);
}
function getNextSnapshot(actorLogic, snapshot, event) {
    var inertActorScope = createInertActorScope(actorLogic);
    inertActorScope.self._snapshot = snapshot;
    return actorLogic.transition(snapshot, event, inertActorScope);
}
function setup(_a) {
    var schemas = _a.schemas, actors = _a.actors, actions = _a.actions, guards = _a.guards, delays = _a.delays;
    return {
        assign: assign,
        sendTo: sendTo,
        raise: raise,
        log: log,
        cancel: cancel,
        stopChild: stopChild,
        enqueueActions: enqueueActions,
        emit: emit,
        spawnChild: spawnChild,
        createStateConfig: function (config) { return config; },
        createAction: function (fn) { return fn; },
        createMachine: function (config) { return createMachine(__assign(__assign({}, config), { schemas: schemas }), {
            actors: actors,
            actions: actions,
            guards: guards,
            delays: delays
        }); },
        extend: function (extended) { return setup({
            schemas: schemas,
            actors: actors,
            actions: __assign(__assign({}, actions), extended.actions),
            guards: __assign(__assign({}, guards), extended.guards),
            delays: __assign(__assign({}, delays), extended.delays)
        }); }
    };
}
var SimulatedClock = /** @class */ (function () {
    function SimulatedClock() {
        this.timeouts = /* @__PURE__ */ new Map();
        this._now = 0;
        this._id = 0;
        this._flushing = false;
        this._flushingInvalidated = false;
    }
    SimulatedClock.prototype.now = function () {
        return this._now;
    };
    SimulatedClock.prototype.getId = function () {
        return this._id++;
    };
    SimulatedClock.prototype.setTimeout = function (fn, timeout) {
        this._flushingInvalidated = this._flushing;
        var id = this.getId();
        this.timeouts.set(id, {
            start: this.now(),
            timeout: timeout,
            fn: fn
        });
        return id;
    };
    SimulatedClock.prototype.clearTimeout = function (id) {
        this._flushingInvalidated = this._flushing;
        this.timeouts.delete(id);
    };
    SimulatedClock.prototype.set = function (time) {
        if (this._now > time) {
            throw new Error("Unable to travel back in time");
        }
        this._now = time;
        this.flushTimeouts();
    };
    SimulatedClock.prototype.flushTimeouts = function () {
        var e_58, _a;
        if (this._flushing) {
            this._flushingInvalidated = true;
            return;
        }
        this._flushing = true;
        var sorted = __spreadArray([], __read(this.timeouts), false).sort(function (_a, _b) {
            var _c = __read(_a, 2), _idA = _c[0], timeoutA = _c[1];
            var _d = __read(_b, 2), _idB = _d[0], timeoutB = _d[1];
            var endA = timeoutA.start + timeoutA.timeout;
            var endB = timeoutB.start + timeoutB.timeout;
            return endB > endA ? -1 : 1;
        });
        try {
            for (var sorted_1 = __values(sorted), sorted_1_1 = sorted_1.next(); !sorted_1_1.done; sorted_1_1 = sorted_1.next()) {
                var _b = __read(sorted_1_1.value, 2), id = _b[0], timeout = _b[1];
                if (this._flushingInvalidated) {
                    this._flushingInvalidated = false;
                    this._flushing = false;
                    this.flushTimeouts();
                    return;
                }
                if (this.now() - timeout.start >= timeout.timeout) {
                    this.timeouts.delete(id);
                    timeout.fn.call(null);
                }
            }
        }
        catch (e_58_1) { e_58 = { error: e_58_1 }; }
        finally {
            try {
                if (sorted_1_1 && !sorted_1_1.done && (_a = sorted_1.return)) _a.call(sorted_1);
            }
            finally { if (e_58) throw e_58.error; }
        }
        this._flushing = false;
    };
    SimulatedClock.prototype.increment = function (ms) {
        this._now += ms;
        this.flushTimeouts();
    };
    return SimulatedClock;
}());
function toPromise(actor) {
    return new Promise(function (resolve, reject) {
        actor.subscribe({
            complete: function () {
                resolve(actor.getSnapshot().output);
            },
            error: reject
        });
    });
}
function transition(logic, snapshot, event) {
    var executableActions = [];
    var actorScope = createInertActorScope(logic);
    actorScope.actionExecutor = function (action) {
        executableActions.push(action);
    };
    var nextSnapshot = logic.transition(snapshot, event, actorScope);
    return [nextSnapshot, executableActions];
}
function initialTransition(logic) {
    var _a = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        _a[_i - 1] = arguments[_i];
    }
    var _b = __read(_a, 1), input = _b[0];
    var executableActions = [];
    var actorScope = createInertActorScope(logic);
    actorScope.actionExecutor = function (action) {
        executableActions.push(action);
    };
    var nextSnapshot = logic.getInitialSnapshot(actorScope, input);
    return [nextSnapshot, executableActions];
}
function getMicrosteps(machine, snapshot, event) {
    var actorScope = createInertActorScope(machine);
    var microsteps = macrostep(snapshot, event, actorScope, []).microsteps;
    return microsteps;
}
function getInitialMicrosteps(machine) {
    var _a = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        _a[_i - 1] = arguments[_i];
    }
    var _b = __read(_a, 1), input = _b[0];
    var actorScope = createInertActorScope(machine);
    var initEvent = createInitEvent(input);
    var internalQueue = [];
    var preInitialSnapshot = machine._getPreInitialState(actorScope, initEvent, internalQueue);
    var first = initialMicrostep(machine.root, preInitialSnapshot, actorScope, initEvent, internalQueue);
    var microsteps = macrostep(first[0], initEvent, actorScope, internalQueue).microsteps;
    return __spreadArray([first], __read(microsteps), false);
}
function getNextTransitions(state) {
    var e_59, _a, e_60, _b, e_61, _c;
    var potentialTransitions = [];
    var atomicStates = state._nodes.filter(isAtomicStateNode);
    var visited = /* @__PURE__ */ new Set();
    try {
        for (var atomicStates_2 = __values(atomicStates), atomicStates_2_1 = atomicStates_2.next(); !atomicStates_2_1.done; atomicStates_2_1 = atomicStates_2.next()) {
            var stateNode = atomicStates_2_1.value;
            try {
                for (var _d = (e_60 = void 0, __values([stateNode].concat(getProperAncestors(stateNode, void 0)))), _e = _d.next(); !_e.done; _e = _d.next()) {
                    var s = _e.value;
                    if (visited.has(s.id)) {
                        continue;
                    }
                    visited.add(s.id);
                    try {
                        for (var _f = (e_61 = void 0, __values(s.transitions)), _g = _f.next(); !_g.done; _g = _f.next()) {
                            var _h = __read(_g.value, 2), transitions = _h[1];
                            potentialTransitions.push.apply(potentialTransitions, __spreadArray([], __read(transitions), false));
                        }
                    }
                    catch (e_61_1) { e_61 = { error: e_61_1 }; }
                    finally {
                        try {
                            if (_g && !_g.done && (_c = _f.return)) _c.call(_f);
                        }
                        finally { if (e_61) throw e_61.error; }
                    }
                    if (s.always) {
                        potentialTransitions.push.apply(potentialTransitions, __spreadArray([], __read(s.always), false));
                    }
                }
            }
            catch (e_60_1) { e_60 = { error: e_60_1 }; }
            finally {
                try {
                    if (_e && !_e.done && (_b = _d.return)) _b.call(_d);
                }
                finally { if (e_60) throw e_60.error; }
            }
        }
    }
    catch (e_59_1) { e_59 = { error: e_59_1 }; }
    finally {
        try {
            if (atomicStates_2_1 && !atomicStates_2_1.done && (_a = atomicStates_2.return)) _a.call(atomicStates_2);
        }
        finally { if (e_59) throw e_59.error; }
    }
    return potentialTransitions;
}
var defaultWaitForOptions = {
    timeout: Infinity
    // much more than 10 seconds
};
function waitFor(actorRef, predicate, options) {
    var resolvedOptions = __assign(__assign({}, defaultWaitForOptions), options);
    return new Promise(function (res, rej) {
        var signal = resolvedOptions.signal;
        if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
            rej(signal.reason);
            return;
        }
        var done = false;
        var handle = resolvedOptions.timeout === Infinity ? void 0 : setTimeout(function () {
            dispose();
            rej(new Error("Timeout of ".concat(resolvedOptions.timeout, " ms exceeded")));
        }, resolvedOptions.timeout);
        var dispose = function () {
            clearTimeout(handle);
            done = true;
            sub === null || sub === void 0 ? void 0 : sub.unsubscribe();
            if (abortListener) {
                signal.removeEventListener("abort", abortListener);
            }
        };
        function checkEmitted(emitted) {
            if (predicate(emitted)) {
                dispose();
                res(emitted);
            }
        }
        var abortListener;
        var sub;
        checkEmitted(actorRef.getSnapshot());
        if (done) {
            return;
        }
        if (signal) {
            abortListener = function () {
                dispose();
                rej(signal.reason);
            };
            signal.addEventListener("abort", abortListener);
        }
        sub = actorRef.subscribe({
            next: checkEmitted,
            error: function (err) {
                dispose();
                rej(err);
            },
            complete: function () {
                dispose();
                rej(new Error("Actor terminated without satisfying predicate"));
            }
        });
        if (done) {
            sub.unsubscribe();
        }
    });
}
export { Actor, SimulatedClock, SpecialTargets, StateMachine, StateNode, getAllOwnEventDescriptors as __unsafe_getAllOwnEventDescriptors, and, assertEvent, assign, cancel, createActor, createEmptyActor, createMachine, emit, enqueueActions, forwardTo, fromCallback, fromEventObservable, fromObservable, fromPromise, fromTransition, getInitialMicrosteps, getInitialSnapshot, getMicrosteps, getNextSnapshot, getNextTransitions, getStateNodes, initialTransition, interpret, isMachineSnapshot, log, mapState, matchesState, not, or, pathToStateValue, raise, sendParent, sendTo, setup, spawnChild, stateIn, stop, stopChild, toObserver, toPromise, transition, waitFor };
