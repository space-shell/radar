// @xstate/react, bundled and downlevelled to ES5 by scripts/vendor.mjs.
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
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ (function (x) { return typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: function (a, b) { return (typeof require !== "undefined" ? require : a)[b]; }
}) : x; })(function (x) {
    if (typeof require !== "undefined")
        return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = function (cb, mod) { return function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
}; };
var __copyProps = function (to, from, except, desc) {
    var e_1, _a;
    if (from && typeof from === "object" || typeof from === "function") {
        var _loop_1 = function (key) {
            if (!__hasOwnProp.call(to, key) && key !== except)
                __defProp(to, key, { get: function () { return from[key]; }, enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
        };
        try {
            for (var _b = __values(__getOwnPropNames(from)), _c = _b.next(); !_c.done; _c = _b.next()) {
                var key = _c.value;
                _loop_1(key);
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
            }
            finally { if (e_1) throw e_1.error; }
        }
    }
    return to;
};
var __toESM = function (mod, isNodeMode, target) { return (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
// If the importer is in node compatibility mode or this is not an ESM
// file that has been converted to a CommonJS file using a Babel-
// compatible transform (i.e. "__esModule" has not been set), then set
// "default" to the CommonJS "module.exports" for node compatibility.
isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target, mod)); };
// node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.production.js
var require_use_sync_external_store_shim_production = __commonJS({
    "node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.production.js": function (exports) {
        "use strict";
        var React2 = __require("react");
        function is2(x, y) {
            return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
        }
        var objectIs = "function" === typeof Object.is ? Object.is : is2;
        var useState2 = React2.useState;
        var useEffect2 = React2.useEffect;
        var useLayoutEffect2 = React2.useLayoutEffect;
        var useDebugValue = React2.useDebugValue;
        function useSyncExternalStore$2(subscribe, getSnapshot) {
            var value = getSnapshot(), _useState = useState2({ inst: { value: value, getSnapshot: getSnapshot } }), inst = _useState[0].inst, forceUpdate = _useState[1];
            useLayoutEffect2(function () {
                inst.value = value;
                inst.getSnapshot = getSnapshot;
                checkIfSnapshotChanged(inst) && forceUpdate({ inst: inst });
            }, [subscribe, value, getSnapshot]);
            useEffect2(function () {
                checkIfSnapshotChanged(inst) && forceUpdate({ inst: inst });
                return subscribe(function () {
                    checkIfSnapshotChanged(inst) && forceUpdate({ inst: inst });
                });
            }, [subscribe]);
            useDebugValue(value);
            return value;
        }
        function checkIfSnapshotChanged(inst) {
            var latestGetSnapshot = inst.getSnapshot;
            inst = inst.value;
            try {
                var nextValue = latestGetSnapshot();
                return !objectIs(inst, nextValue);
            }
            catch (error) {
                return true;
            }
        }
        function useSyncExternalStore$1(subscribe, getSnapshot) {
            return getSnapshot();
        }
        var shim = "undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement ? useSyncExternalStore$1 : useSyncExternalStore$2;
        exports.useSyncExternalStore = void 0 !== React2.useSyncExternalStore ? React2.useSyncExternalStore : shim;
    }
});
// node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.development.js
var require_use_sync_external_store_shim_development = __commonJS({
    "node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.development.js": function (exports) {
        "use strict";
        "production" !== process.env.NODE_ENV && (function () {
            function is2(x, y) {
                return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
            }
            function useSyncExternalStore$2(subscribe, getSnapshot) {
                didWarnOld18Alpha || void 0 === React2.startTransition || (didWarnOld18Alpha = true, console.error("You are using an outdated, pre-release alpha of React 18 that does not support useSyncExternalStore. The use-sync-external-store shim will not work correctly. Upgrade to a newer pre-release."));
                var value = getSnapshot();
                if (!didWarnUncachedGetSnapshot) {
                    var cachedValue = getSnapshot();
                    objectIs(value, cachedValue) || (console.error("The result of getSnapshot should be cached to avoid an infinite loop"), didWarnUncachedGetSnapshot = true);
                }
                cachedValue = useState2({
                    inst: { value: value, getSnapshot: getSnapshot }
                });
                var inst = cachedValue[0].inst, forceUpdate = cachedValue[1];
                useLayoutEffect2(function () {
                    inst.value = value;
                    inst.getSnapshot = getSnapshot;
                    checkIfSnapshotChanged(inst) && forceUpdate({ inst: inst });
                }, [subscribe, value, getSnapshot]);
                useEffect2(function () {
                    checkIfSnapshotChanged(inst) && forceUpdate({ inst: inst });
                    return subscribe(function () {
                        checkIfSnapshotChanged(inst) && forceUpdate({ inst: inst });
                    });
                }, [subscribe]);
                useDebugValue(value);
                return value;
            }
            function checkIfSnapshotChanged(inst) {
                var latestGetSnapshot = inst.getSnapshot;
                inst = inst.value;
                try {
                    var nextValue = latestGetSnapshot();
                    return !objectIs(inst, nextValue);
                }
                catch (error) {
                    return true;
                }
            }
            function useSyncExternalStore$1(subscribe, getSnapshot) {
                return getSnapshot();
            }
            "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
            var React2 = __require("react"), objectIs = "function" === typeof Object.is ? Object.is : is2, useState2 = React2.useState, useEffect2 = React2.useEffect, useLayoutEffect2 = React2.useLayoutEffect, useDebugValue = React2.useDebugValue, didWarnOld18Alpha = false, didWarnUncachedGetSnapshot = false, shim = "undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement ? useSyncExternalStore$1 : useSyncExternalStore$2;
            exports.useSyncExternalStore = void 0 !== React2.useSyncExternalStore ? React2.useSyncExternalStore : shim;
            "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
        })();
    }
});
// node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/shim/index.js
var require_shim = __commonJS({
    "node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/shim/index.js": function (exports, module) {
        "use strict";
        if (process.env.NODE_ENV === "production") {
            module.exports = require_use_sync_external_store_shim_production();
        }
        else {
            module.exports = require_use_sync_external_store_shim_development();
        }
    }
});
// node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.production.js
var require_with_selector_production = __commonJS({
    "node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.production.js": function (exports) {
        "use strict";
        var React2 = __require("react");
        var shim = require_shim();
        function is2(x, y) {
            return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
        }
        var objectIs = "function" === typeof Object.is ? Object.is : is2;
        var useSyncExternalStore2 = shim.useSyncExternalStore;
        var useRef = React2.useRef;
        var useEffect2 = React2.useEffect;
        var useMemo = React2.useMemo;
        var useDebugValue = React2.useDebugValue;
        exports.useSyncExternalStoreWithSelector = function (subscribe, getSnapshot, getServerSnapshot, selector, isEqual) {
            var instRef = useRef(null);
            if (null === instRef.current) {
                var inst = { hasValue: false, value: null };
                instRef.current = inst;
            }
            else
                inst = instRef.current;
            instRef = useMemo(function () {
                function memoizedSelector(nextSnapshot) {
                    if (!hasMemo) {
                        hasMemo = true;
                        memoizedSnapshot = nextSnapshot;
                        nextSnapshot = selector(nextSnapshot);
                        if (void 0 !== isEqual && inst.hasValue) {
                            var currentSelection = inst.value;
                            if (isEqual(currentSelection, nextSnapshot))
                                return memoizedSelection = currentSelection;
                        }
                        return memoizedSelection = nextSnapshot;
                    }
                    currentSelection = memoizedSelection;
                    if (objectIs(memoizedSnapshot, nextSnapshot))
                        return currentSelection;
                    var nextSelection = selector(nextSnapshot);
                    if (void 0 !== isEqual && isEqual(currentSelection, nextSelection))
                        return memoizedSnapshot = nextSnapshot, currentSelection;
                    memoizedSnapshot = nextSnapshot;
                    return memoizedSelection = nextSelection;
                }
                var hasMemo = false, memoizedSnapshot, memoizedSelection, maybeGetServerSnapshot = void 0 === getServerSnapshot ? null : getServerSnapshot;
                return [
                    function () {
                        return memoizedSelector(getSnapshot());
                    },
                    null === maybeGetServerSnapshot ? void 0 : function () {
                        return memoizedSelector(maybeGetServerSnapshot());
                    }
                ];
            }, [getSnapshot, getServerSnapshot, selector, isEqual]);
            var value = useSyncExternalStore2(subscribe, instRef[0], instRef[1]);
            useEffect2(function () {
                inst.hasValue = true;
                inst.value = value;
            }, [value]);
            useDebugValue(value);
            return value;
        };
    }
});
// node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js
var require_with_selector_development = __commonJS({
    "node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js": function (exports) {
        "use strict";
        "production" !== process.env.NODE_ENV && (function () {
            function is2(x, y) {
                return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
            }
            "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
            var React2 = __require("react"), shim = require_shim(), objectIs = "function" === typeof Object.is ? Object.is : is2, useSyncExternalStore2 = shim.useSyncExternalStore, useRef = React2.useRef, useEffect2 = React2.useEffect, useMemo = React2.useMemo, useDebugValue = React2.useDebugValue;
            exports.useSyncExternalStoreWithSelector = function (subscribe, getSnapshot, getServerSnapshot, selector, isEqual) {
                var instRef = useRef(null);
                if (null === instRef.current) {
                    var inst = { hasValue: false, value: null };
                    instRef.current = inst;
                }
                else
                    inst = instRef.current;
                instRef = useMemo(function () {
                    function memoizedSelector(nextSnapshot) {
                        if (!hasMemo) {
                            hasMemo = true;
                            memoizedSnapshot = nextSnapshot;
                            nextSnapshot = selector(nextSnapshot);
                            if (void 0 !== isEqual && inst.hasValue) {
                                var currentSelection = inst.value;
                                if (isEqual(currentSelection, nextSnapshot))
                                    return memoizedSelection = currentSelection;
                            }
                            return memoizedSelection = nextSnapshot;
                        }
                        currentSelection = memoizedSelection;
                        if (objectIs(memoizedSnapshot, nextSnapshot))
                            return currentSelection;
                        var nextSelection = selector(nextSnapshot);
                        if (void 0 !== isEqual && isEqual(currentSelection, nextSelection))
                            return memoizedSnapshot = nextSnapshot, currentSelection;
                        memoizedSnapshot = nextSnapshot;
                        return memoizedSelection = nextSelection;
                    }
                    var hasMemo = false, memoizedSnapshot, memoizedSelection, maybeGetServerSnapshot = void 0 === getServerSnapshot ? null : getServerSnapshot;
                    return [
                        function () {
                            return memoizedSelector(getSnapshot());
                        },
                        null === maybeGetServerSnapshot ? void 0 : function () {
                            return memoizedSelector(maybeGetServerSnapshot());
                        }
                    ];
                }, [getSnapshot, getServerSnapshot, selector, isEqual]);
                var value = useSyncExternalStore2(subscribe, instRef[0], instRef[1]);
                useEffect2(function () {
                    inst.hasValue = true;
                    inst.value = value;
                }, [value]);
                useDebugValue(value);
                return value;
            };
            "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
        })();
    }
});
// node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/shim/with-selector.js
var require_with_selector = __commonJS({
    "node_modules/.pnpm/use-sync-external-store@1.7.0_react@19.1.0/node_modules/use-sync-external-store/shim/with-selector.js": function (exports, module) {
        "use strict";
        if (process.env.NODE_ENV === "production") {
            module.exports = require_with_selector_production();
        }
        else {
            module.exports = require_with_selector_development();
        }
    }
});
// node_modules/.pnpm/@xstate+react@6.1.0_@types+react@19.2.18_react@19.1.0_xstate@5.33.2/node_modules/@xstate/react/dist/xstate-react.esm.js
import * as React from "react";
import { useEffect, useState, useCallback } from "react";
// node_modules/.pnpm/use-isomorphic-layout-effect@1.2.1_@types+react@19.2.18_react@19.1.0/node_modules/use-isomorphic-layout-effect/dist/use-isomorphic-layout-effect.esm.js
import { useLayoutEffect } from "react";
var isClient = typeof document !== "undefined";
var noop = function noop2() {
};
var index = isClient ? useLayoutEffect : noop;
// node_modules/.pnpm/@xstate+react@6.1.0_@types+react@19.2.18_react@19.1.0_xstate@5.33.2/node_modules/@xstate/react/dist/xstate-react.esm.js
var import_with_selector = __toESM(require_with_selector());
var import_shim = __toESM(require_shim());
import { toObserver, createActor } from "../../shared/vendor/xstate.mjs";
var forEachActor = function (actorRef, callback) {
    callback(actorRef);
    var children = actorRef.getSnapshot().children;
    if (children) {
        Object.values(children).forEach(function (child) {
            forEachActor(child, callback);
        });
    }
};
function stopRootWithRehydration(actorRef) {
    var _a, _b;
    var persistedSnapshots = [];
    forEachActor(actorRef, function (ref) {
        persistedSnapshots.push([ref, ref.getSnapshot()]);
        ref.observers = /* @__PURE__ */ new Set();
    });
    var systemSnapshot = (_b = (_a = actorRef.system).getSnapshot) === null || _b === void 0 ? void 0 : _b.call(_a);
    actorRef.stop();
    actorRef.system._snapshot = systemSnapshot;
    persistedSnapshots.forEach(function (_a) {
        var _b = __read(_a, 2), ref = _b[0], snapshot = _b[1];
        ref._processingStatus = 0;
        ref._snapshot = snapshot;
    });
}
function useIdleActorRef(logic) {
    var _a = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        _a[_i - 1] = arguments[_i];
    }
    var _b = __read(_a, 1), options = _b[0];
    var _c = __read(useState(function () {
        var actorRef2 = createActor(logic, options);
        return [logic.config, actorRef2];
    }), 2), _d = __read(_c[0], 2), currentConfig = _d[0], actorRef = _d[1], setCurrent = _c[1];
    if (logic.config !== currentConfig) {
        var newActorRef = createActor(logic, __assign(__assign({}, options), { snapshot: actorRef.getPersistedSnapshot({
                __unsafeAllowInlineActors: true
            }) }));
        setCurrent([logic.config, newActorRef]);
        actorRef = newActorRef;
    }
    index(function () {
        actorRef.logic.implementations = logic.implementations;
    });
    return actorRef;
}
function useActorRef(machine) {
    var _a = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        _a[_i - 1] = arguments[_i];
    }
    var _b = __read(_a, 2), options = _b[0], observerOrListener = _b[1];
    var actorRef = useIdleActorRef(machine, options);
    useEffect(function () {
        if (!observerOrListener) {
            return;
        }
        var sub = actorRef.subscribe(toObserver(observerOrListener));
        return function () {
            sub.unsubscribe();
        };
    }, [observerOrListener]);
    useEffect(function () {
        actorRef.start();
        return function () {
            stopRootWithRehydration(actorRef);
        };
    }, [actorRef]);
    return actorRef;
}
function defaultCompare(a, b) {
    return a === b;
}
function useSelector(actor, selector, compare) {
    if (compare === void 0) { compare = defaultCompare; }
    var subscribe = useCallback(function (handleStoreChange) {
        if (!actor) {
            return function () {
            };
        }
        var unsubscribe = actor.subscribe({
            next: handleStoreChange,
            error: handleStoreChange
        }).unsubscribe;
        return unsubscribe;
    }, [actor]);
    var boundGetSnapshot = useCallback(function () {
        var snapshot = actor === null || actor === void 0 ? void 0 : actor.getSnapshot();
        if (snapshot && "status" in snapshot && snapshot.status === "error") {
            throw snapshot.error;
        }
        return snapshot;
    }, [actor]);
    var selectedSnapshot = (0, import_with_selector.useSyncExternalStoreWithSelector)(subscribe, boundGetSnapshot, boundGetSnapshot, selector, compare);
    return selectedSnapshot;
}
function createActorContext(actorLogic, actorOptions) {
    var ReactContext = /* @__PURE__ */ React.createContext(null);
    var OriginalProvider = ReactContext.Provider;
    function Provider(_a) {
        var children = _a.children, _b = _a.logic, providedLogic = _b === void 0 ? actorLogic : _b, machine = _a.machine, providedOptions = _a.options;
        if (machine) {
            throw new Error("The \"machine\" prop has been deprecated. Please use \"logic\" instead.");
        }
        var actor = useActorRef(providedLogic, __assign(__assign({}, actorOptions), providedOptions));
        return /* @__PURE__ */ React.createElement(OriginalProvider, {
            value: actor,
            children: children
        });
    }
    Provider.displayName = "ActorProvider";
    function useContext2() {
        var actor = React.useContext(ReactContext);
        if (!actor) {
            throw new Error("You used a hook from \"".concat(Provider.displayName, "\" but it's not inside a <").concat(Provider.displayName, "> component."));
        }
        return actor;
    }
    function useSelector$1(selector, compare) {
        var actor = useContext2();
        return useSelector(actor, selector, compare);
    }
    return {
        Provider: Provider,
        useActorRef: useContext2,
        useSelector: useSelector$1
    };
}
function is(x, y) {
    if (x === y) {
        return x !== 0 || y !== 0 || 1 / x === 1 / y;
    }
    else {
        return x !== x && y !== y;
    }
}
function shallowEqual(objA, objB) {
    if (is(objA, objB))
        return true;
    if (typeof objA !== "object" || objA === null || typeof objB !== "object" || objB === null) {
        return false;
    }
    var keysA = Object.keys(objA);
    var keysB = Object.keys(objB);
    if (keysA.length !== keysB.length)
        return false;
    for (var i = 0; i < keysA.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) || !is(objA[keysA[i]], objB[keysA[i]])) {
            return false;
        }
    }
    return true;
}
function useActor(logic) {
    var _a = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        _a[_i - 1] = arguments[_i];
    }
    var _b = __read(_a, 1), options = _b[0];
    var actorRef = useIdleActorRef(logic, options);
    var getSnapshot = useCallback(function () {
        return actorRef.getSnapshot();
    }, [actorRef]);
    var subscribe = useCallback(function (handleStoreChange) {
        var unsubscribe = actorRef.subscribe({
            next: handleStoreChange,
            error: handleStoreChange
        }).unsubscribe;
        return unsubscribe;
    }, [actorRef]);
    var actorSnapshot = (0, import_shim.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
    var snapshotWithStatus = "status" in actorSnapshot ? actorSnapshot : void 0;
    if ((snapshotWithStatus === null || snapshotWithStatus === void 0 ? void 0 : snapshotWithStatus.status) === "error") {
        throw snapshotWithStatus.error;
    }
    useEffect(function () {
        actorRef.start();
        return function () {
            stopRootWithRehydration(actorRef);
        };
    }, [actorRef]);
    return [actorSnapshot, actorRef.send, actorRef];
}
function useMachine(machine) {
    var _a = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        _a[_i - 1] = arguments[_i];
    }
    var _b = __read(_a, 1), options = _b[0];
    return useActor(machine, options);
}
export { createActorContext, shallowEqual, useActor, useActorRef, useMachine, useSelector };
/*! Bundled license information:

use-sync-external-store/cjs/use-sync-external-store-shim.production.js:
  (**
   * @license React
   * use-sync-external-store-shim.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

use-sync-external-store/cjs/use-sync-external-store-shim.development.js:
  (**
   * @license React
   * use-sync-external-store-shim.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.production.js:
  (**
   * @license React
   * use-sync-external-store-shim/with-selector.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js:
  (**
   * @license React
   * use-sync-external-store-shim/with-selector.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
