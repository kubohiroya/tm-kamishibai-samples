import assert from 'node:assert/strict';

import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';

const dataUrlPrefix = 'data:text/javascript;base64,';
const assetManagerExtensionId = 'kubohiroyaassetmanager';
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

export const actorCloneRuntimePatch = Object.freeze({
  id: 'kubohiroya-asset-manager-actor-clone-compatibility',
  outputName: 'kamishibai-actor-clone-runtime.sb3',
  extensionVersion: '2026-07-27-actor-clone-compatibility',
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

export function patchActorCloneRuntime(baseSb3) {
  const archive = unzipSync(new Uint8Array(baseSb3));
  const project = JSON.parse(strFromU8(archive['project.json']));
  const dataUrl = project.extensionURLs?.[assetManagerExtensionId];
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
  project.extensionURLs[assetManagerExtensionId] =
    `${dataUrlPrefix}${Buffer.from(source).toString('base64')}`;
  archive['project.json'] = strToU8(`${JSON.stringify(project)}\n`);

  return Buffer.from(
    zipSync(orderedArchive(archive), {level: 6, mtime: fixedZipTimestamp}),
  );
}
