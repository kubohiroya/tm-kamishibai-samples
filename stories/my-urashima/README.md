# my-urashima

2026-08-01ワークショップ用の依存ストーリーです。`../urashima/source.txt`、アセットロック、generic base SB3を親入力として使用し、外部台本専用の`my-urashima.sb3`を生成します。

`Princess`は独立したScratchスプライトとして定義し、親ストーリーのPrincess PNGを同名コスチュームとして直接組み込みます。台本では最短表記`asset=Princess,costume`で参照し、`Actor`スプライトにはPrincessコスチュームを組み込みません。

`my-urashima.sb3`には台本を埋め込みません。`tmposeEmbeddedScript`、台本用リスト、`.txt` ZIPエントリは空のままにし、`my-urashima.txt`を外部から読み込んで使用します。

親入力や設定を意図的に変更した場合は、リポジトリルートで次を実行してチェックイン済み成果物とロックを更新します。

```bash
pnpm update:my-urashima
```

通常の`pnpm build`は同じ成果物を一時生成し、チェックイン済みSB3・台本・ロックとの一致を検証します。
