import assert from 'node:assert/strict';

import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';

const dataUrlPrefix = 'data:text/javascript;base64,';
const fixedZipTimestamp = new Date(1980, 0, 1, 0, 0, 0, 0);
const originalVersion = 'const EXTENSION_VERSION = "2026-07-26";';
const patchedVersion =
  'const EXTENSION_VERSION = "2026-07-27-actor-clone-compatibility";';
const originalSizeCorrection = `      if (!target.isStage && skin.sourceSize !== null && target.size !== skin.sourceSize) {
        target.setSize(skin.sourceSize);
      }`;
const patchedSizeCorrection = `      if (
        !target.isStage
        && target.isOriginal
        && skin.sourceSize !== null
        && target.size !== skin.sourceSize
      ) {
        target.setSize(skin.sourceSize);
      }`;
const originalResolver = `    resolveActorTarget(actor, util) {
      const matches = this.runtime.targets.filter(
        (target2) => !target2.isStage && target2.sprite?.name === actor
      );
      if (matches.length > 1) {
        throw new Error(\`Actor name is not unique: \${actor}\`);
      }
      const invokingTarget = util?.target;
      if (invokingTarget && !invokingTarget.isStage && invokingTarget.sprite?.name === actor) {
        return invokingTarget;
      }
      const target = matches[0] ?? this.findTargetByName(actor);
      if (!target) throw new Error(\`Actor not found: \${actor}\`);
      return target;
    }`;
const patchedResolver = `    actorNameOf(target) {
      return normalizeName(
        target?.lookupVariableByNameAndType?.("actorName", "")?.value
      );
    }
    resolveActorTarget(actor, util) {
      const invokingTarget = util?.target;
      if (
        invokingTarget
        && !invokingTarget.isStage
        && (
          this.actorNameOf(invokingTarget) === actor
          || invokingTarget.sprite?.name === actor
        )
      ) {
        return invokingTarget;
      }
      const actorNameMatches = this.runtime.targets.filter(
        (target2) => !target2.isStage && this.actorNameOf(target2) === actor
      );
      const matches = actorNameMatches.length > 0
        ? actorNameMatches
        : this.runtime.targets.filter(
          (target2) => !target2.isStage && target2.sprite?.name === actor
        );
      if (matches.length > 1) {
        throw new Error(\`Actor name is not unique: \${actor}\`);
      }
      const target = matches[0] ?? this.findTargetByName(actor);
      if (!target) throw new Error(\`Actor not found: \${actor}\`);
      return target;
    }`;

const whiteTransitions = Object.freeze({
  fadeToWhite: Object.freeze({
    change: '5',
    finalBrightness: '100',
    x: 7700,
  }),
  fadeFromWhite: Object.freeze({
    change: '-5',
    finalBrightness: '0',
    x: 8240,
  }),
});

export const urashimaRuntimePatch = Object.freeze({
  id: 'urashima-runtime-compatibility',
  outputName: 'kamishibai-urashima-runtime.sb3',
  extensionVersion: '2026-07-27-actor-clone-compatibility',
  transitionActions: Object.freeze(Object.keys(whiteTransitions)),
});

function replaceExactlyOnce(source, before, after, description) {
  const parts = source.split(before);
  assert.equal(parts.length, 2, `${description} must occur exactly once.`);
  return `${parts[0]}${after}${parts[1]}`;
}

function orderedArchive(archive) {
  return Object.fromEntries(
    Object.entries(archive)
      .filter(([entryName]) => !entryName.endsWith('/'))
      .sort(([left], [right]) => {
        if (left === 'project.json') return -1;
        if (right === 'project.json') return 1;
        return left.localeCompare(right, 'en');
      }),
  );
}

function addWhiteTransitionProcedure(blocks, transitionName, configuration) {
  const idPrefix = `transition-${transitionName}`;
  const ids = {
    definition: `${idPrefix}-definition`,
    prototype: `${idPrefix}-prototype`,
    repeat: `${idPrefix}-repeat`,
    condition: `${idPrefix}-condition`,
    noSkip: `${idPrefix}-no-skip`,
    skipExists: `${idPrefix}-skip-exists`,
    change: `${idPrefix}-change`,
    wait: `${idPrefix}-wait`,
    final: `${idPrefix}-final`,
  };
  for (const id of Object.values(ids)) {
    assert.equal(blocks[id], undefined, `Transition block ID already exists: ${id}`);
  }

  blocks[ids.definition] = {
    opcode: 'procedures_definition',
    next: ids.repeat,
    parent: null,
    inputs: {custom_block: [1, ids.prototype]},
    fields: {},
    shadow: false,
    topLevel: true,
    x: configuration.x,
    y: 2000,
  };
  blocks[ids.prototype] = {
    opcode: 'procedures_prototype',
    next: null,
    parent: ids.definition,
    inputs: {},
    fields: {},
    shadow: true,
    topLevel: false,
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode: `exec transition ${transitionName}`,
      argumentids: '[]',
      argumentnames: '[]',
      argumentdefaults: '[]',
      warp: 'false',
    },
  };
  blocks[ids.repeat] = {
    opcode: 'control_repeat',
    next: ids.final,
    parent: ids.definition,
    inputs: {
      TIMES: [1, [6, '20']],
      SUBSTACK: [2, ids.condition],
    },
    fields: {},
    shadow: false,
    topLevel: false,
  };
  blocks[ids.condition] = {
    opcode: 'control_if',
    next: null,
    parent: ids.repeat,
    inputs: {
      CONDITION: [2, ids.noSkip],
      SUBSTACK: [2, ids.change],
    },
    fields: {},
    shadow: false,
    topLevel: false,
  };
  blocks[ids.noSkip] = {
    opcode: 'operator_not',
    next: null,
    parent: ids.condition,
    inputs: {OPERAND: [2, ids.skipExists]},
    fields: {},
    shadow: false,
    topLevel: false,
  };
  blocks[ids.skipExists] = {
    opcode: 'lmsTempVars2_runtimeVariableExists',
    next: null,
    parent: ids.noSkip,
    inputs: {VAR: [1, [10, 'skipMode']]},
    fields: {},
    shadow: false,
    topLevel: false,
  };
  blocks[ids.change] = {
    opcode: 'looks_changeeffectby',
    next: ids.wait,
    parent: ids.condition,
    inputs: {CHANGE: [1, [4, configuration.change]]},
    fields: {EFFECT: ['BRIGHTNESS', null]},
    shadow: false,
    topLevel: false,
  };
  blocks[ids.wait] = {
    opcode: 'control_wait',
    next: null,
    parent: ids.change,
    inputs: {DURATION: [1, [5, '0.05']]},
    fields: {},
    shadow: false,
    topLevel: false,
  };
  blocks[ids.final] = {
    opcode: 'looks_seteffectto',
    next: null,
    parent: ids.repeat,
    inputs: {VALUE: [1, [4, configuration.finalBrightness]]},
    fields: {EFFECT: ['BRIGHTNESS', null]},
    shadow: false,
    topLevel: false,
  };
}

function addWhiteTransitionDispatch(blocks, resetCall) {
  const resetCondition = {id: resetCall.parent, ...blocks[resetCall.parent]};
  assert.equal(resetCondition?.opcode, 'control_if_else');
  assert.deepEqual(resetCondition.inputs.SUBSTACK, [2, resetCall.id]);
  assert.equal(resetCondition.inputs.SUBSTACK2, undefined);

  const transitions = Object.keys(whiteTransitions);
  let parentCondition = resetCondition;
  for (const [index, transitionName] of transitions.entries()) {
    const idPrefix = `dispatch-transition-${transitionName}`;
    const ids = {
      condition: `${idPrefix}-condition`,
      equals: `${idPrefix}-equals`,
      argument: `${idPrefix}-argument`,
      call: `${idPrefix}-call`,
    };
    for (const id of Object.values(ids)) {
      assert.equal(blocks[id], undefined, `Transition dispatch block ID already exists: ${id}`);
    }

    parentCondition.inputs.SUBSTACK2 = [2, ids.condition];
    blocks[ids.condition] = {
      opcode: 'control_if_else',
      next: null,
      parent: parentCondition.id,
      inputs: {
        CONDITION: [2, ids.equals],
        SUBSTACK: [2, ids.call],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    };
    blocks[ids.equals] = {
      opcode: 'operator_equals',
      next: null,
      parent: ids.condition,
      inputs: {
        OPERAND1: [3, ids.argument, [10, '']],
        OPERAND2: [1, [10, transitionName]],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    };
    blocks[ids.argument] = {
      opcode: 'argument_reporter_string_number',
      next: null,
      parent: ids.equals,
      inputs: {},
      fields: {VALUE: ['transitionName', null]},
      shadow: false,
      topLevel: false,
    };
    blocks[ids.call] = {
      opcode: 'procedures_call',
      next: null,
      parent: ids.condition,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: false,
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: `exec transition ${transitionName}`,
        argumentids: '[]',
        warp: 'false',
      },
    };

    if (index < transitions.length - 1) {
      parentCondition = {id: ids.condition, ...blocks[ids.condition]};
    }
  }
}

function addWhiteTransitions(project) {
  const stage = project.targets.find((target) => target.isStage);
  assert.ok(stage, 'Base SB3 Stage target is missing.');
  const blocks = stage.blocks;
  const resetCallEntry = Object.entries(blocks).find(
    ([, block]) =>
      block.opcode === 'procedures_call' &&
      block.mutation?.proccode === 'exec transition reset',
  );
  assert.ok(resetCallEntry, 'Transition reset dispatch call is missing.');
  const resetCall = {id: resetCallEntry[0], ...resetCallEntry[1]};

  addWhiteTransitionDispatch(blocks, resetCall);
  for (const [transitionName, configuration] of Object.entries(whiteTransitions)) {
    addWhiteTransitionProcedure(blocks, transitionName, configuration);
  }
}

export function patchUrashimaRuntime(baseSb3) {
  const archive = unzipSync(new Uint8Array(baseSb3));
  const project = JSON.parse(strFromU8(archive['project.json']));
  const dataUrl = project.extensionURLs?.twAssetManager;
  assert.equal(
    typeof dataUrl === 'string' && dataUrl.startsWith(dataUrlPrefix),
    true,
    'Base SB3 must embed Asset Manager as a JavaScript data URL.',
  );

  let source = Buffer.from(dataUrl.slice(dataUrlPrefix.length), 'base64').toString('utf8');
  source = replaceExactlyOnce(
    source,
    originalVersion,
    patchedVersion,
    'Asset Manager version marker',
  );
  source = replaceExactlyOnce(
    source,
    originalResolver,
    patchedResolver,
    'Asset Manager actor target resolver',
  );
  source = replaceExactlyOnce(
    source,
    originalSizeCorrection,
    patchedSizeCorrection,
    'Asset Manager costume source size correction',
  );
  project.extensionURLs.twAssetManager =
    `${dataUrlPrefix}${Buffer.from(source).toString('base64')}`;
  addWhiteTransitions(project);
  archive['project.json'] = strToU8(`${JSON.stringify(project)}\n`);

  return Buffer.from(
    zipSync(orderedArchive(archive), {level: 6, mtime: fixedZipTimestamp}),
  );
}
