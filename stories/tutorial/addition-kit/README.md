# addition kit

`new-beach.svg`と`friend.svg`を`tutorial-story/`直下へコピーし、YAML断片を順に
`story.kamishibai.yaml`へ反映します。

1. `add-background-and-actor.yml.txt`: 背景、登場人物、`meeting`場面を追加
2. `add-pose-scene.yml.txt`: 同梱済み`rescue-pose`を使う`rescue`場面を追加

`intentional-diagnostic.kamishibai.yaml.txt`は診断修正の練習用です。`.txt`を外して正式CLIで
validateし、`Turtle.sya`に対する診断を確認してから`Turtle.say`へ直します。修正後はvalidateが
成功し、通常のstarterと同じ入力としてbuildできます。

ファイルはMPL-2.0で提供します。詳しくは同梱の`LICENSES.md`を確認してください。
