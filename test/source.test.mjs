import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

import {validateAssetManifest} from '@kubohiroya/tmpose-kamishibai/builder';
import {strFromU8, unzipSync} from 'fflate';
import {parse as parseYaml} from 'yaml';

import {
  AUDIO_UNLOCK_CLOCK_CHECK_DELAY_MS,
  AUDIO_UNLOCK_EVENTS,
  AUDIO_UNLOCK_LIFECYCLE_EVENTS,
  AUDIO_UNLOCK_SCRIPT,
  buildPackagedWeb,
  DEFAULT_WEB_CONFIGURATION,
} from '../scripts/build-packaged-web.mjs';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sampleDirectory = path.join(projectRoot, 'stories/urashima');
const require = createRequire(import.meta.url);

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function readSb3Project(contents) {
  const archive = unzipSync(new Uint8Array(contents));
  return JSON.parse(strFromU8(archive['project.json']));
}

function inspectPalettePng(contents) {
  assert.deepEqual(
    contents.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    'PNG signature differs',
  );
  let colorType;
  let height;
  let paletteEntries;
  let transparent = false;
  let width;
  for (let offset = 8; offset + 12 <= contents.length; ) {
    const length = contents.readUInt32BE(offset);
    const type = contents.subarray(offset + 4, offset + 8).toString('ascii');
    const data = contents.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'PLTE') paletteEntries = length / 3;
    else if (type === 'tRNS') transparent = data.some((alpha) => alpha < 255);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  return {colorType, height, paletteEntries, transparent, width};
}

function assertLoadingBubbleAnchor(project, description) {
  const loading = project.targets.find((target) => target.name === 'Loading');
  const anchor = project.targets.find((target) => target.name === 'LoadingBubbleAnchor');
  assert.ok(loading, `${description}: Loading target is missing`);
  assert.ok(anchor, `${description}: LoadingBubbleAnchor target is missing`);
  assert.equal(
    Object.values(loading.blocks).some((block) => block.opcode === 'looks_say'),
    false,
    `${description}: Loading still contains looks_say`,
  );
  assert.equal(
    Object.values(anchor.blocks).some((block) => block.opcode === 'looks_say'),
    true,
    `${description}: LoadingBubbleAnchor does not contain looks_say`,
  );
  assert.deepEqual([anchor.x, anchor.y], [1, -20]);
}

function assertPromptPosition(project, description) {
  const prompt = project.targets.find((target) => target.name === 'prompt');
  assert.ok(prompt, `${description}: prompt target is missing`);
  assert.deepEqual(
    {x: prompt.x, y: prompt.y, size: prompt.size},
    {x: -8, y: 150, size: 100},
    `${description}: prompt target layout differs`,
  );
}

function assertLoadingSkinPosition(project, description) {
  const loading = project.targets.find((target) => target.name === 'Loading');
  assert.ok(loading, `${description}: Loading target is missing`);
  assert.deepEqual(
    [loading.x, loading.y],
    [1, -62],
    `${description}: Loading target position differs`,
  );
}

test('licenses the repository, runtime, Urashima content, and Packager notices', async () => {
  const runtimePackagePath = require.resolve('@kubohiroya/tmpose-kamishibai/package.json');
  const runtimePackageLicensePath = path.join(path.dirname(runtimePackagePath), 'LICENSE');
  const [
    packageJson,
    runtimePackageJson,
    license,
    runtimePackageLicense,
    licenseSummary,
    runtimeLicense,
    packagerNotice,
  ] = await Promise.all([
    readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(runtimePackagePath, 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'LICENSE'), 'utf8'),
    readFile(runtimePackageLicensePath, 'utf8'),
    readFile(path.join(sampleDirectory, 'LICENSES.md'), 'utf8'),
    readFile(
      path.join(sampleDirectory, 'licenses/tmpose-kamishibai-MPL-2.0.txt'),
      'utf8',
    ),
    readFile(path.join(sampleDirectory, 'licenses/turbowarp-packager-NOTICE.md'), 'utf8'),
  ]);
  assert.equal(packageJson.license, 'MPL-2.0');
  assert.equal(runtimePackageJson.license, 'MPL-2.0');
  assert(license.startsWith('Mozilla Public License Version 2.0'));
  assert(runtimePackageLicense.startsWith('Mozilla Public License Version 2.0'));
  assert(licenseSummary.includes('MPL-2.0'));
  assert(licenseSummary.includes('CC BY-SA 2.0'));
  assert(licenseSummary.includes('7bd800cb66d6fb18886a4c5cea1b76a6'));
  assert(licenseSummary.includes('tmpose-kamishibai-MPL-2.0.txt'));
  assert(licenseSummary.includes('2b5005d293a9b63c8ba5da396fd86815d093f975'));
  assert(runtimeLicense.startsWith('Mozilla Public License Version 2.0'));
  assert.equal(runtimeLicense, runtimePackageLicense);
  assert.equal(runtimeLicense, license);
  assert(licenseSummary.includes('turbowarp-packager-NOTICE.md'));
  assert(packagerNotice.includes('TurboWarp Packager 3.13.0'));
  assert(packagerNotice.includes('MPL-2.0'));
});

test('keeps the migrated Scratch assets complete and content-addressed', async () => {
  const directories = [
    ['images', 26],
    ['sounds', 22],
  ];
  for (const [directory, expectedCount] of directories) {
    const assetDirectory = path.join(sampleDirectory, 'assets', directory);
    const filenames = await readdir(assetDirectory);
    assert.equal(filenames.length, expectedCount);
    for (const filename of filenames) {
      const contents = await readFile(path.join(assetDirectory, filename));
      const md5 = createHash('md5').update(contents).digest('hex');
      assert.equal(md5, path.parse(filename).name, filename);
      if (directory === 'sounds') {
        assert.equal(path.extname(filename), '.mp3');
        assert.equal(contents.subarray(0, 3).toString('ascii'), 'ID3');
      }
    }
  }
});

test('keeps all Urashima actor costumes as compact transparent 64-color PNGs', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(sampleDirectory, 'assets.lock.json'), 'utf8'),
  );
  const actorAssets = manifest.assets.filter(
    (asset) => asset.kind === 'costume' && asset.target === 'Actor',
  );
  const expectedGeometry = {
    Fish1: [354, 359, 177, 179.5],
    Fish2: [353, 360, 173, 180],
    Princess: [360, 360, 180, 180],
    Turtle: [352, 355, 173, 178],
    'Urashima-box-1': [360, 360, 180, 180],
    'Urashima-box-2': [321, 338, 160.5, 169],
    'Urashima-dance-1': [352, 347, 176, 173.25],
    'Urashima-dance-2': [324, 320, 162, 160],
    'Urashima-help-1': [321, 301, 173, 141],
    'Urashima-old-1': [360, 360, 180, 180],
    'Urashima-old-2': [238, 215, 124, 93.5],
    'Urashima-open-1': [360, 360, 180, 180],
    'Urashima-open-2': [259, 264, 129.25, 132],
    'Urashima-open-3': [360, 360, 180, 180],
    'Urashima-ride-1': [358, 355, 178.75, 177.5],
    'Urashima-ride-2': [360, 360, 180, 180],
    'Urashima-surprised': [321, 338, 160.5, 169],
    'Urashima-walk-1': [360, 360, 180, 180],
  };
  assert.equal(actorAssets.length, 18);
  assert.deepEqual(new Set(actorAssets.map(({name}) => name)), new Set(Object.keys(expectedGeometry)));
  assert.equal(
    actorAssets.find(({name}) => name === 'Turtle').sha256,
    '5a0453a5fa35ce55ad7ba06122e983432d8c796af6fb88860a76e46ef90d3cfa',
    'Turtle must preserve the restored right-facing composition',
  );
  for (const asset of actorAssets) {
    assert.equal(asset.contentType, 'image/png');
    assert.equal(asset.dataFormat, 'png');
    assert.equal(asset.metadata.bitmapResolution, 1);
    const contents = await readFile(path.join(sampleDirectory, asset.uri.slice('file:'.length)));
    const png = inspectPalettePng(contents);
    assert.equal(png.colorType, 3, `${asset.name} must use an indexed PNG palette`);
    assert(png.paletteEntries <= 64, `${asset.name} exceeds 64 palette entries`);
    assert.equal(png.transparent, true, `${asset.name} lost transparency`);
    const [width, height, rotationCenterX, rotationCenterY] = expectedGeometry[asset.name];
    assert.deepEqual([png.width, png.height], [width, height], `${asset.name} dimensions differ`);
    assert.deepEqual(
      [asset.metadata.rotationCenterX, asset.metadata.rotationCenterY],
      [rotationCenterX, rotationCenterY],
      `${asset.name} rotation center differs`,
    );
  }
  const originalBytes = 6_161_004;
  const compactBytes = actorAssets.reduce((total, asset) => total + asset.size, 0);
  assert(compactBytes < originalBytes * 0.1, 'Actor assets must be at least 90% smaller.');
});

test('pins the generic, editor, and player profile contract', async () => {
  const [packageJson, config, artifactsLock, baseSb3] = await Promise.all([
    readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sampleDirectory, 'sample.config.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sampleDirectory, 'artifacts.lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sampleDirectory, 'base/kamishibai.sb3')),
  ]);
  assert.equal(
    packageJson.dependencies['@kubohiroya/tmpose-kamishibai'],
    '3.2.2',
  );
  assert.equal(config.builder.version, '3.2.2');
  assert.equal(config.builder.commit, '2b5005d293a9b63c8ba5da396fd86815d093f975');
  assert.equal(config.baseSb3.profile, 'generic');
  assert.equal(
    config.baseSb3.source,
    'github:kubohiroya/tm-kamishibai#2b5005d293a9b63c8ba5da396fd86815d093f975',
  );
  assert.equal(
    config.baseSb3.commit,
    '2b5005d293a9b63c8ba5da396fd86815d093f975',
  );
  assert.equal(config.baseSb3.size, baseSb3.length);
  assert.equal(config.baseSb3.sha256, sha256(baseSb3));
  const baseArchive = unzipSync(new Uint8Array(baseSb3));
  const baseProject = JSON.parse(strFromU8(baseArchive['project.json']));
  assert(baseProject.extensions.includes('tmposebundle'));
  const tmposeBundleSource = Buffer.from(
    baseProject.extensionURLs.tmposebundle.split(',')[1],
    'base64',
  ).toString('utf8');
  assert(tmposeBundleSource.includes('const EXTENSION_VERSION = "0.4.1"'));
  assert(tmposeBundleSource.includes('ID: kubohiroyasvgtext'));
  assert(tmposeBundleSource.includes('this.actorNameOf(target2) === actor'));
  assert(tmposeBundleSource.includes('target.isOriginal'));
  assert(tmposeBundleSource.includes('this.displayedAssets.delete(target.id)'));
  assert(tmposeBundleSource.includes('findProjectTargetByName(runtime, name)'));
  assertPromptPosition(baseProject, 'generic base');
  assertLoadingSkinPosition(baseProject, 'generic base');
  const baseStage = baseProject.targets.find((target) => target.isStage);
  const baseBlocks = Object.values(baseStage.blocks);
  const transitionProcedures = new Set(
    baseBlocks
      .filter((block) => block.opcode === 'procedures_prototype')
      .map((block) => block.mutation?.proccode),
  );
  const transitionDispatchNames = new Set(
    baseBlocks
      .filter((block) => block.opcode === 'operator_equals')
      .map((block) => block.inputs.OPERAND2?.[1]?.[1]),
  );
  for (const transitionAction of ['fadeToWhite', 'fadeFromWhite']) {
    assert(transitionProcedures.has(`exec transition ${transitionAction}`));
    assert(transitionDispatchNames.has(transitionAction));
  }
  const finalBrightnessByTransition = Object.fromEntries(
    ['fadeOut', 'fadeUp', 'fadeToWhite', 'fadeFromWhite'].map((transitionAction) => {
      const prototypeEntry = Object.entries(baseStage.blocks).find(
        ([, block]) =>
          block.opcode === 'procedures_prototype' &&
          block.mutation?.proccode === `exec transition ${transitionAction}`,
      );
      assert.ok(prototypeEntry, `${transitionAction} prototype is missing`);
      const definition = baseStage.blocks[prototypeEntry[1].parent];
      const repeat = baseStage.blocks[definition.next];
      const finalBrightness = baseStage.blocks[repeat.next];
      assert.equal(finalBrightness.opcode, 'looks_seteffectto');
      return [transitionAction, Number(finalBrightness.inputs.VALUE[1][1])];
    }),
  );
  assert.deepEqual(finalBrightnessByTransition, {
    fadeOut: -100,
    fadeUp: 0,
    fadeToWhite: 100,
    fadeFromWhite: 0,
  });
  assert.equal(artifactsLock.formatVersion, 2);
  assert.deepEqual(config.profiles, {
    editor: {outputName: '_urashima', script: 'external', assets: 'embedded'},
    player: {outputName: 'urashima', script: 'embedded', assets: 'embedded'},
  });
  assert.deepEqual(Object.keys(artifactsLock.profiles).sort(), ['editor', 'player']);
  assert.deepEqual(DEFAULT_WEB_CONFIGURATION, {
    enabled: false,
    audioUnlock: {enabled: false},
  });
  assert.equal(packageJson.devDependencies['@turbowarp/packager'], '3.13.0');
  assert.equal(config.web.enabled, true);
  assert.equal(config.web.inputProfile, 'player');
  assert.equal(config.web.scriptMode, 'embedded');
  assert.equal(config.web.assets, 'embedded');
  assert.deepEqual(config.web.audioUnlock, {enabled: true});
  assert.equal(config.web.packager.version, '3.13.0');
  assert.equal(config.web.packager.options.target, 'html');
  assert.equal(config.web.packager.options.autoplay, true);
  assert.equal(config.web.packager.options.app.windowTitle, '浦島太郎 | TM紙芝居');
  assert.equal(config.web.packager.options.cloudVariables.mode, 'disabled');
  assert.deepEqual(artifactsLock.web.input, {
    profile: 'player',
    path: 'urashima.sb3',
    ...artifactsLock.profiles.player.sb3,
  });

  const project = readSb3Project(baseSb3);
  const stage = project.targets.find((target) => target.isStage);
  const titleArchive = unzipSync(new Uint8Array(baseSb3));
  const titleCostume = stage.costumes.find(({name}) => name === 'Title');
  const runtimeTitleCostume = stage.costumes.find(({name}) => name === 'TitleRuntime');
  assert.ok(titleCostume, 'Urashima base: Title costume is missing');
  assert.ok(runtimeTitleCostume, 'Urashima base: TitleRuntime costume is missing');
  assert.equal(
    stage.costumes.some(({name}) => name === 'Title-en'),
    false,
    'Urashima base: retired Title-en costume remains',
  );
  assert.match(
    strFromU8(titleArchive[titleCostume.md5ext]),
    /Version 3\.2\.2 \(2026\/08\/05\)/,
    'Urashima base: Title has an unexpected fallback version label',
  );
  assert.doesNotMatch(
    strFromU8(titleArchive[runtimeTitleCostume.md5ext]),
    /<text\b/u,
    'Urashima base: TitleRuntime must remain blank',
  );
  assert.deepEqual(stage.variables.tmposeEmbeddedScript, ['__tmpose_embedded_script', '']);
  assert.deepEqual(
    project.targets.map((target) => target.name),
    [
      'Stage',
      'Actor',
      'prompt',
      'UiItem',
      'officialWebsiteButton',
      'closeTitleButton',
      'Loading',
      'LoadingBubbleAnchor',
    ],
  );
  assert.equal(
    Object.values(stage.variables).some(([name]) => name === 'featureCloneUiItems'),
    false,
  );
  assert.deepEqual(stage.variables.cloneUiItemsEnabled, ['cloneUiItemsEnabled', true]);
  assertLoadingBubbleAnchor(project, 'Urashima base');
  assertPromptPosition(project, 'Urashima base');
  assertLoadingSkinPosition(project, 'Urashima base');
});

test('keeps my-urashima external-script-only and publishes its DSL 4.0 workshop source', async () => {
  const [myUrashima, script, dsl4, config, projectAssets, artifactsLock, princessSource] =
    await Promise.all([
      readFile(path.join(projectRoot, 'stories/my-urashima/my-urashima.sb3')),
      readFile(path.join(projectRoot, 'stories/my-urashima/my-urashima.txt'), 'utf8'),
      readFile(path.join(projectRoot, 'stories/my-urashima/my-urashima.k4.yml'), 'utf8'),
      readFile(path.join(projectRoot, 'stories/my-urashima/sample.config.json'), 'utf8').then(
        JSON.parse,
      ),
      readFile(path.join(projectRoot, 'stories/my-urashima/project-assets.yml'), 'utf8').then(
        parseYaml,
      ),
      readFile(path.join(projectRoot, 'stories/my-urashima/artifacts.lock.json'), 'utf8').then(
        JSON.parse,
      ),
      readFile(path.join(projectRoot, 'stories/my-urashima/assets/Princess-720.png')),
    ]);
  const archive = unzipSync(new Uint8Array(myUrashima));
  const project = JSON.parse(strFromU8(archive['project.json']));
  const stage = project.targets.find((target) => target.isStage);
  const actor = project.targets.find((target) => target.name === 'Actor');
  const princess = project.targets.find((target) => target.name === 'Princess');

  assertLoadingBubbleAnchor(project, 'my-urashima');
  assertPromptPosition(project, 'my-urashima');
  assertLoadingSkinPosition(project, 'my-urashima');
  assert.ok(princess, 'my-urashima: Princess target is missing');
  assert.deepEqual(
    princess.costumes.map(({name, dataFormat}) => ({name, dataFormat})),
    [{name: 'Princess', dataFormat: 'png'}],
  );
  const princessCostume = princess.costumes[0];
  const princessAssetId = createHash('md5').update(princessSource).digest('hex');
  assert.equal(princessCostume.assetId, princessAssetId);
  assert.equal(princessCostume.md5ext, `${princessAssetId}.png`);
  assert.equal(Buffer.from(archive[princessCostume.md5ext]).equals(princessSource), true);
  assert.equal(
    sha256(princessSource),
    artifactsLock.projectAssets.files[0].source.sha256,
  );
  assert.deepEqual(
    {
      bitmapResolution: princessCostume.bitmapResolution,
      rotationCenterX: princessCostume.rotationCenterX,
      rotationCenterY: princessCostume.rotationCenterY,
    },
    {bitmapResolution: 2, rotationCenterX: 360, rotationCenterY: 360},
  );
  assert.deepEqual(
    [princessSource.readUInt32BE(16), princessSource.readUInt32BE(20)],
    [720, 720],
  );
  assert.equal(princess.size, 70);
  assert.equal(
    actor.costumes.some(({name}) => name === 'Princess'),
    false,
  );
  assert.deepEqual(stage.variables.tmposeEmbeddedScript, ['__tmpose_embedded_script', '']);
  assert.equal(
    Object.values(stage.lists).every(([, values]) => values.length === 0),
    true,
  );
  assert.deepEqual(
    Object.keys(archive).filter((filename) => filename.endsWith('.txt')),
    [],
  );
  assert.equal(script.includes('asset=Princess,costume\n'), true);
  assert.equal(script.includes('asset=Princess,costume:Actor'), false);
  assert.equal(script.includes('asset=Sewing Machine,sound:@stage:Sewing Machine'), true);
  assert.equal(
    script.includes('setPoseRecognitionSound=Clock Ticking,Sewing Machine'),
    true,
  );
  assert.equal(script.includes('action=Princess:show:Princess:-130,-27,70'), true);
  assert.equal(script.includes('action=Princess:setSkin:p1:70'), false);
  assert.equal(
    script.includes(
      [
        'action=Urashima:setSkin:Urashima-dance-1:45',
        'action=wait:1',
        '#action=Princess:pose:p1,p2,p1,p2:p1,p2,p1,p2:Drum Funky,Drum Funky,Drum Funky,Drum Funky',
      ].join('\n'),
    ),
    true,
  );
  assert.equal(script.includes('action=Urashima:pose:Urashima-dance-1'), false);
  assert.equal(config.scriptReplacements[0].to, 'action=wait:1');
  assert.deepEqual(config.parentStory, {
    name: 'urashima',
    config: '../urashima/sample.config.json',
  });
  assert.deepEqual(config.profile, {
    outputName: 'my-urashima',
    script: 'external',
    assets: 'embedded',
  });
  assert.deepEqual(config.projectAssets, {
    manifest: 'project-assets.yml',
    allowedRoots: ['assets'],
  });
  assert.deepEqual(projectAssets.sprites.Princess, {
    layerOrder: 6,
    visible: false,
    x: 4,
    y: -16,
    size: 70,
    direction: 90,
    draggable: false,
    rotationStyle: 'all around',
    volume: 100,
  });
  assert.deepEqual(projectAssets.assets.Princess, {
    kind: 'costume',
    target: 'Princess',
    file: 'assets/Princess-720.png',
    bitmapResolution: 2,
    rotationCenterX: 360,
    rotationCenterY: 360,
    license: 'CC-BY-SA-4.0: ../../resources/20260801/LICENSES.md',
  });
  assert.equal(artifactsLock.parentStory.name, 'urashima');
  assert.deepEqual(artifactsLock.sb3Toolchain, {
    package: '@kubohiroya/sb3-toolchain',
    version: '0.6.0',
    source: '0.6.0',
  });
  assert.equal(artifactsLock.parentStory.sourceScript.path, '../urashima/source.txt');
  assert.equal(artifactsLock.parentStory.assetManifest.path, '../urashima/assets.lock.json');
  assert.equal(artifactsLock.output.sb3.sha256, sha256(myUrashima));
  assert.equal(artifactsLock.output.script.sha256, sha256(script));
  assert.deepEqual(artifactsLock.projectAssets.files, [
    {
      id: 'Princess',
      kind: 'costume',
      target: 'Princess',
      license: 'CC-BY-SA-4.0: ../../resources/20260801/LICENSES.md',
      source: {
        path: 'assets/Princess-720.png',
        size: 92889,
        sha256: 'aefb045b41322faf9dc2c8117141362206ff5dcfcf6ef9b660c3f2709ab5a178',
      },
    },
  ]);
  assert(dsl4.startsWith('kamishibai: "4.0"\n'));
  const dsl4Document = parseYaml(dsl4);
  assert.deepEqual(dsl4Document.controls.keymaps.production, {
    Space: 'rehearsal.skipPose',
    ArrowRight: 'rehearsal.skipAction',
    ArrowDown: 'rehearsal.skipScene',
  });
  assert.equal(dsl4Document.poseRecognition.navigation.allowSkip, true);
  assert.match(dsl4, /^\s{2}Princess: costume:Princess$/mu);
  assert.match(dsl4, /^\s{2}Princess: Princess$/mu);
  assert.match(
    dsl4,
    /^#  p1: costume:Princess\n#  p2: costume:Princess\n#  p3: costume:Princess\n#  p4: costume:Princess$/mu,
  );
  assert.equal((dsl4.match(/^#      - Princess\.pose:/gmu) ?? []).length, 3);
  assert.equal((dsl4.match(/^\s{6}- Princess\.pose:/gmu) ?? []).length, 0);
  assert.match(dsl4, /^\s{2}welcome to dragon castle:\n\s{4}poseModel: PoseModel2$/mu);
  assert.match(
    dsl4,
    /^\s{6}- Urashima\.setSkin:\n\s{10}skin: Urashima-dance-1\n\s{6}- wait: 1\n(?:^#.*\n){4}\s{6}- wait: 2$/mu,
  );
});

test('keeps shared Packager output disabled unless a sample enables it', async () => {
  assert.deepEqual(await buildPackagedWeb({}), {enabled: false});
});

test('recovers interrupted or stalled-running WebKit audio after touch completion', async () => {
  const createEventTarget = () => {
    const listeners = new Map();
    return {
      listeners,
      addEventListener(eventName, listener) {
        if (!listeners.has(eventName)) listeners.set(eventName, new Set());
        listeners.get(eventName).add(listener);
      },
      removeEventListener(eventName, listener) {
        listeners.get(eventName)?.delete(listener);
      },
      dispatch(eventName, properties = {}) {
        for (const listener of [...(listeners.get(eventName) ?? [])]) {
          listener({type: eventName, ...properties});
        }
      },
    };
  };

  let currentTime = 4;
  let resumeCalls = 0;
  let suspendCalls = 0;
  let primeStarts = 0;
  const timers = [];
  const audioContext = {
    state: 'interrupted',
    sampleRate: 44100,
    destination: {},
    get currentTime() {
      return currentTime;
    },
    createBuffer() {
      return {};
    },
    createBufferSource() {
      return {
        buffer: null,
        onended: null,
        connect() {},
        disconnect() {},
        start() {
          primeStarts += 1;
          this.onended?.();
        },
      };
    },
    async resume() {
      resumeCalls += 1;
      this.state = 'running';
    },
    async suspend() {
      suspendCalls += 1;
      this.state = 'suspended';
    },
  };
  const documentTarget = createEventTarget();
  const windowTarget = createEventTarget();
  const document = Object.assign(documentTarget, {visibilityState: 'visible'});
  const window = Object.assign(windowTarget, {
    scaffolding: {vm: {runtime: {audioEngine: {audioContext}}}},
    setTimeout(callback, delay) {
      timers.push({callback, delay});
    },
  });
  runInNewContext(AUDIO_UNLOCK_SCRIPT, {
    console: {warn() {}},
    document,
    window,
  });

  assert.deepEqual(AUDIO_UNLOCK_EVENTS, [
    'pointerdown',
    'pointerup',
    'touchend',
    'mousedown',
    'click',
    'keydown',
  ]);
  assert.deepEqual(AUDIO_UNLOCK_LIFECYCLE_EVENTS, ['visibilitychange', 'pageshow']);
  assert.equal(window.__tmposeAudioUnlockState.listenersInstalled, true);

  document.dispatch('pointerdown', {pointerType: 'touch'});
  assert.equal(window.__tmposeAudioUnlockState.ignoredEvents, 1);
  assert.equal(resumeCalls, 0);

  document.dispatch('pointerup', {pointerType: 'touch'});
  await new Promise(setImmediate);
  assert.equal(resumeCalls, 1);
  assert.equal(suspendCalls, 0);
  assert.equal(primeStarts, 2);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, AUDIO_UNLOCK_CLOCK_CHECK_DELAY_MS);
  currentTime += 0.5;
  timers.shift().callback();
  assert.equal(window.__tmposeAudioUnlockState.lastEvent, 'pointerup');
  assert.equal(window.__tmposeAudioUnlockState.lastPointerType, 'touch');
  assert.equal(window.__tmposeAudioUnlockState.completed, true);
  assert.equal(window.__tmposeAudioUnlockState.clockAdvanced, true);
  assert.equal(window.__tmposeAudioUnlockState.primeCompletions, 2);
  assert.equal(window.__tmposeAudioUnlockState.listenersInstalled, false);

  window.__tmposeAudioUnlockState.hasActivated = false;
  window.dispatch('pageshow', {persisted: true});
  audioContext.state = 'running';
  document.dispatch('pointerup', {pointerType: 'touch'});
  await new Promise(setImmediate);
  assert.equal(resumeCalls, 2);
  assert.equal(suspendCalls, 1);
  assert.equal(timers.length, 1);
  currentTime += 0.5;
  timers.shift().callback();
  assert.equal(window.__tmposeAudioUnlockState.completed, true);
  assert.equal(window.__tmposeAudioUnlockState.clockAdvanced, true);
  assert.equal(window.__tmposeAudioUnlockState.primeCompletions, 4);

  audioContext.state = 'suspended';
  window.dispatch('pageshow', {persisted: true});
  await new Promise(setImmediate);
  assert.equal(resumeCalls, 3);
  assert.equal(timers.length, 1);
  currentTime += 0.5;
  timers.shift().callback();
  assert.equal(window.__tmposeAudioUnlockState.lifecycleEvents, 1);
  assert.equal(window.__tmposeAudioUnlockState.lastLifecycleEvent, 'pageshow');
  assert.equal(window.__tmposeAudioUnlockState.completed, true);
  assert.equal(window.__tmposeAudioUnlockState.clockAdvanced, true);
  assert.equal(window.__tmposeAudioUnlockState.primeCompletions, 6);
});

test('locks every external script asset and publishes DSL 3.2 and offline DSL 4.0 scripts', async () => {
  const [source, published, dsl4, rawAssetManifest] = await Promise.all([
    readFile(path.join(sampleDirectory, 'source.txt'), 'utf8'),
    readFile(path.join(sampleDirectory, 'urashima.txt'), 'utf8'),
    readFile(path.join(sampleDirectory, 'urashima.k4.yml'), 'utf8'),
    readFile(path.join(sampleDirectory, 'assets.lock.json'), 'utf8').then(JSON.parse),
  ]);
  const assetManifest = validateAssetManifest(rawAssetManifest);
  const expectedSceneComments = Array.from(
    {length: 10},
    (_, index) => `# scene ${index}`,
  );
  for (const script of [source, published]) {
    assert(script.startsWith('kamishibai=3.2\n'));
    assert.deepEqual(script.match(/^# scene \d+$/gmu), expectedSceneComments);
  }
  assert(dsl4.startsWith('kamishibai: "4.0"\n'));
  const dsl4Document = parseYaml(dsl4);
  const dsl4Assets = Object.values(dsl4Document.assets);
  assert.equal(dsl4Assets.length, 49);
  assert.equal(
    dsl4Assets.every(
      (asset) =>
        typeof asset === 'object' &&
        typeof asset.file === 'string' &&
        asset.delivery !== 'remote' &&
        asset.source === undefined,
    ),
    true,
  );
  assert.equal(dsl4Document.assets.PoseModel1.file, 'pose-models/1and2');
  assert.equal(dsl4Document.assets.PoseModel2.file, 'pose-models/3and4');
  assert.equal(dsl4Document.assets.PoseModel3.file, 'pose-models/6and7');
  assert.match(dsl4, /^\s{2}opening:\n/mu);
  assert.match(dsl4, /^\s{2}beach:\n\s{4}poseModel: PoseModel1\n\s{4}actions:$/mu);
  assert.match(dsl4, /^\s{6}- Urashima\.pose:\n\s{10}steps:\n/mu);
  assert.deepEqual(dsl4Document.controls.keymaps.production, {
    Space: 'rehearsal.skipPose',
    ArrowRight: 'rehearsal.skipAction',
    ArrowDown: 'rehearsal.skipScene',
  });
  assert.equal(dsl4Document.poseRecognition.navigation.allowSkip, true);
  const externalLines = source
    .split(/\r?\n/u)
    .filter((line) => /^asset=.*,(?:file|https?):/u.test(line));
  assert.equal(externalLines.length, 44);
  assert.equal(assetManifest.assets.length, 44);
  assert.equal(
    assetManifest.assets
      .filter((asset) => asset.kind === 'stageSound')
      .every((asset) => asset.contentType === 'audio/mpeg' && asset.dataFormat === 'mp3'),
    true,
  );
  assert.deepEqual(
    new Set(externalLines.map((line) => line.slice('asset='.length, line.indexOf(',')))),
    new Set(assetManifest.assets.map((asset) => asset.name)),
  );
  assert.equal(/^(?:asset=.*,(?:file|https?):)/mu.test(published), false);
  assert.equal(published.includes('asset=Stars,backdrop'), true);
  assert.equal(
    published.includes('asset=TextPlaceholder,costume:prompt:ui-placeholder'),
    true,
  );
  assert.equal(/^asset=.*?,text$/mu.test(published), false);
  assert.equal(source.includes('setLoadingBackdrop=Stars'), true);
  assert.equal(published.includes('setLoadingBackdrop=Stars'), true);
  assert.equal(source.includes('setLoadingCostume=Fish1,Fish2'), true);
  assert.equal(published.includes('setLoadingCostume=Fish1,Fish2'), true);
  assert.equal(
    source.includes('asset=Sewing Machine,file:assets/sounds/cfc75b8ec10d522a49e754cee372fcb9.mp3'),
    true,
  );
  assert.equal(
    published.includes('asset=Sewing Machine,sound:@stage:Sewing Machine'),
    true,
  );
  assert.equal(
    source.includes('setPoseRecognitionSound=Clock Ticking,Sewing Machine'),
    true,
  );
  assert.equal(
    published.includes('setPoseRecognitionSound=Clock Ticking,Sewing Machine'),
    true,
  );
  for (const definition of ['text=ui.prompt:ポーズをとろう！']) {
    assert.equal(published.includes(definition), true, definition);
  }
  for (const definition of [
    'svgTextStyle=default:#ffffff:#575e75:Helvetica:100:left:up-right',
    'svgTextStyle=narration:#00000000:#ffffff:Noto Sans JP:200:center:up',
    'svgTextStyle=ending:#00000000:#ffffff:Noto Sans JP:300:center:up',
  ]) {
    assert.equal(published.includes(definition), true, definition);
  }
  for (const obsoleteDefinition of [
    'text=ui.invalidScript:',
    'text=ui.open:',
    'text=ui.reload:',
    'text=ui.about:',
  ]) {
    assert.equal(source.includes(obsoleteDefinition), false, obsoleteDefinition);
    assert.equal(published.includes(obsoleteDefinition), false, obsoleteDefinition);
  }
  assert.equal(/^action=text:/mu.test(published), false);
  assert.equal(
    published.includes('action=Narration:setText:むかし:narration'),
    true,
  );
  assert.equal(
    published.includes(
      'action=Narration:setText:むかし　むかし、\\nあるところに...:narration',
    ),
    true,
  );
  assert.equal(
    published.includes('action=Narration:setText:お し ま い:ending'),
    true,
  );
  assert.equal(
    published.match(/^action=Narration:show:TextPlaceholder:0,0,100$/gmu)?.length,
    2,
  );
  const danceScene = published.slice(
    published.indexOf('sceneLabel=welcome to dragon castle'),
    published.indexOf('sceneLabel=goodbye dragon castle'),
  );
  const danceFishActions = [
    'action=bgm:Jump',
    'action=Fish:show:Fish1:-130,-27,70',
    'action=Fish:setLayer:back',
    'action=Fish:loop:Fish1,Fish2:0.3,0.3',
    'action=Urashima:setSkin:Urashima-dance-1:45',
  ];
  assert.equal(danceFishActions.every((action) => danceScene.includes(action)), true);
  assert.deepEqual(
    danceFishActions.map((action) => danceScene.indexOf(action)),
    danceFishActions.map((action) => danceScene.indexOf(action)).toSorted((a, b) => a - b),
  );
  assert.equal(danceScene.includes('action=Fish:show:-130,-27,70'), false);
  assert.equal(/^setRuntimeVariable=Narration:/mu.test(published), false);
  assert.equal(/^action=Prompt:show:Narration:/mu.test(published), false);
});
