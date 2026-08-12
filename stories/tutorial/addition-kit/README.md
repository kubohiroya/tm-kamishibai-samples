# addition kit

`earthquake-classroom.svg`と`protect-head.svg`を`tutorial-story/`直下へコピーし、YAML断片を順に
`story.kamishibai.yaml`へ反映します。

1. `add-background-and-actor.yml.txt`: 揺れている教室、頭を守る見本、`instruction`場面を追加
2. `add-pose-scene.yml.txt`: 同梱済み`safety-pose`を使う`protect`場面を追加

`intentional-diagnostic.kamishibai.yaml.txt`は診断修正の練習用です。`.txt`を外して正式CLIで
validateし、`Student.sya`に対する診断を確認してから`Student.say`へ直します。修正後はvalidateが
成功し、通常のstarterと同じ入力としてbuildできます。

この教材は、教室内に丈夫な机がある場面に限定した練習です。実際には周囲の状況に応じて身の安全を
確保してください。

ファイルはMPL-2.0で提供します。詳しくは同梱の`LICENSES.md`を確認してください。
