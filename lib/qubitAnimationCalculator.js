/* global define, module, require */

(function (globals) {
    "use strict";

    function createModule(_, jsqubits) {

        function ensureDependenciesAreSet() {
            _ = _ || globals._;
            jsqubits = jsqubits || globals.jsqubits;
        }

        function calculatorFactory(config) {
            ensureDependenciesAreSet();
            var maxRadius = config.maxRadius,
                smallComplexWithZeroPhase = jsqubits.complex(0.0001);
        
            function yOffSetForState(state) {
                // A single qubit state can have a radius of up to maxRadius,
                // but two (valid) qubit states will be closest when each has a radius of 1/sqrt(2).
                return maxRadius * (state * Math.SQRT2 + 1);
            }
            
            function createPhase1State(stateComponent, subSeq) {
                var phase1State = _.clone(stateComponent);
                phase1State.key = stateComponent.key + '-' + subSeq;
                if (subSeq > 1) {
                    phase1State.amplitude = jsqubits.ZERO;
                }
                return phase1State;
            }

            function createPhase2aState(oldStateComponent, phase1State) {
                var phase2aState = _.clone(phase1State);
                phase2aState.amplitude = oldStateComponent.amplitude;
                return phase2aState;
            }
            
            function createPhase2bState(phase2aState, newStateComponent, phase2bGroupedByState) {
                var phase2bState = _.clone(phase2aState),
                    numericIndex = newStateComponent.asNumber();
                phase2bState.amplitude = phase2aState.amplitude.multiply(newStateComponent.amplitude);
                phase2bState.bitString = newStateComponent.asBitString();
                phase2bState.numericIndex = numericIndex;
                var stateGroup = phase2bGroupedByState[numericIndex];
                if (!stateGroup) {
                    stateGroup = phase2bGroupedByState[numericIndex] = [];
                    phase2bState.x = 2 * maxRadius;
                    phase2bState.y = yOffSetForState(numericIndex);
                } else {
                    var prevState = _.last(stateGroup),
                        prevAmplitude = prevState.amplitude;
                    phase2bState.x = prevState.x + prevAmplitude.real() * config.maxRadius;
                    phase2bState.y = prevState.y - prevAmplitude.imaginary() * config.maxRadius;
                }
                stateGroup.push(phase2bState);
                return phase2bState;
            }

            function mapStateGroupsToKeyGroups(stateGroups) {
                return Object.keys(stateGroups).map(function keyGroupForIndex(index) {
                    return stateGroups[index].map(function extractKey(stateComponent) {
                        return stateComponent.key;
                    });
                });
            }

            function createPhase3(phases, keysGroupedByDestinationState) {

                function sumAllAmplitudesInKeyGroup(keyGroup) {
                    return keyGroup.reduce(function sumAmplitudes(accumulator, key) {
                        return accumulator.add(phases.phase2b[key].amplitude);
                    }, jsqubits.ZERO);
                }

                function addAllAmplitudesToFirstStateComponent(keyGroup) {
                    var totalAmplitude = sumAllAmplitudesInKeyGroup(keyGroup);
                        // NOTE: The first key in the key group is regarded as the 'primary' for the group.
                    var groupPrimaryState = _.clone(phases.phase2b[keyGroup[0]]);

                    // If the amplitude is close to zero then the phase is often quite random and this can cause the disc to rotate in strange ways as it shrinks.
                    // So, when it is close to zero, we simply mupltiply the existing amplitude by a small constant so as to preserve the phase.
                    groupPrimaryState.amplitude = totalAmplitude.magnitude() > 0.0001 ? totalAmplitude : groupPrimaryState.amplitude.multiply(smallComplexWithZeroPhase);

                    phases.phase3.push(groupPrimaryState);
                    return groupPrimaryState;
                }

                function shrinkRemainingAmplitudes(groupPrimaryState, keyGroup) {
                    var totalAmplitude = groupPrimaryState.amplitude;
                    var endOfArrowX = groupPrimaryState.x + totalAmplitude.real() * config.maxRadius;
                    var endOfArrowY = groupPrimaryState.y - totalAmplitude.imaginary() * config.maxRadius;
                    for (var index = 1; index < keyGroup.length; index++) {
                        var key = keyGroup[index];
                        var newStateComponent = _.clone(phases.phase2b[key]);
                        newStateComponent.amplitude = newStateComponent.amplitude.multiply(smallComplexWithZeroPhase);
                        newStateComponent.x = endOfArrowX;
                        newStateComponent.y = endOfArrowY;
                        phases.phase3.push(newStateComponent);
                    }
                }

                keysGroupedByDestinationState.forEach(function (keyGroup) {
                    var groupPrimaryState = addAllAmplitudesToFirstStateComponent(keyGroup);
                    shrinkRemainingAmplitudes(groupPrimaryState, keyGroup);
                });
                
            }

            function createPhases1And2(stateComponents, operation, phases, phase2bGroupedByState) {
                stateComponents.forEach(function(oldStateComponent) {
                    var qstate = operation(jsqubits(oldStateComponent.bitString));
                    var phase1StateGroupIndexes = [];
                    phases.stateComponentIndexesGroupedBySource.push(phase1StateGroupIndexes);
                    var subSeq = 1;
                    qstate.each(function (newStateComponent) {
                        var phase1State = createPhase1State(oldStateComponent, subSeq++);
                        var phase2aState = createPhase2aState(oldStateComponent, phase1State);
                        var key = phase1State.key;
                        phase1StateGroupIndexes.push(phases.phase1.length);
                        phases.phase1.push(phase1State);
                        phases.phase2a[key] = phase2aState;
                        phases.phase2b[key] = createPhase2bState(
                            phase2aState, newStateComponent, phase2bGroupedByState);
                    });
                });
                return phases;
            }
            
            function createPhase4(phases) {
                phases.phase4 = phases.phase3.filter(function hasSignificantAmplitude(stateComponent) {
                    return stateComponent.amplitude.magnitude() > 0.0001;
                });
            }
            
            function createPhase5(phases) {
                phases.phase5 = phases.phase4.map(function cloneWithZeroXOffset(stateComponent) {
                    var result = _.clone(stateComponent);
                    result.x = 0;
                    return result;
                });
            }
            
            function findComponentByIndex(stateComponents, index) {
                var result = null;
                stateComponents.some(function hasMatchingIndex(stateComponent) {
                    if (stateComponent.numericIndex === index) {
                        result = stateComponent;
                        return true;
                    }
                });
                return result;
            }

            return {
                yOffSetForState: yOffSetForState,
                
                augmentState: function (qstate) {
                    var keySequence = 0,
                        stateComponents = [];

                    qstate.each(function(stateComponent) {
                        var augmentedStateComponent = {
                            bitString: stateComponent.asBitString(),
                            numericIndex: stateComponent.asNumber(),
                            amplitude: stateComponent.amplitude,
                            key: 'k' + (++keySequence),
                            x: 0,
                            y: yOffSetForState(stateComponent.asNumber())
                        };
                        stateComponents.push(augmentedStateComponent);
                    });

                    stateComponents.sort(function (stateA, stateB) {
                        return stateA.numericIndex - stateB.numericIndex;
                    });

                    return stateComponents;
                },
                
                createPhases: function (stateComponents, operation) {
                    var phases = {
                        phase1: [],
                        phase2a: {},
                        phase2b: {},
                        stateComponentIndexesGroupedBySource: [],
                        phase3: []
                    };
                    var phase2bGroupedByState = {};
                    createPhases1And2(stateComponents, operation, phases, phase2bGroupedByState);
                    createPhase3(phases, mapStateGroupsToKeyGroups(phase2bGroupedByState));
                    createPhase4(phases);
                    createPhase5(phases);
                    return phases;
                },
                
                createIntermediateState: function (src, dest) {
                    var result = _.clone(src);
                    result.forEach(function adjustAmplitude(srcStateComponent) {
                        var destStateComponent =
                            findComponentByIndex(dest, srcStateComponent.numericIndex);
                        if (destStateComponent && destStateComponent.amplitude.magnitude() > 0) {
                            srcStateComponent.amplitude = destStateComponent.amplitude;
                        } else {
                            srcStateComponent.amplitude =
                                srcStateComponent.amplitude.multiply(smallComplexWithZeroPhase);
                        }
                    });
                    return result;
                }
            };
        }
        return calculatorFactory;
    }
    
    /* Support AMD and CommonJS, with a fallback of using the global namespace */
    if (typeof define !== 'undefined' && define.amd) {
        define(['lodash', 'jsqubits'], createModule);
    } else if (typeof module !== 'undefined' && module.exports) {
        module.exports = createModule(require('lodash'), require('jsqubits').jsqubits);
    } else {
        globals.animatedQubitsInternal = globals.animatedQubitsInternal || {};
        globals.animatedQubitsInternal.calculatorFactory = createModule();
    }

    
})(this);