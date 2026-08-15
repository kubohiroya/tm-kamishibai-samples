# 地震だ！頭を守ろう — DSL 4.0チュートリアル作品

DSL 4.0チュートリアルの「紙芝居を遊ぶ」「紙芝居を作る」で共通利用する、4場面の
最小作品です。教室で地震の揺れを感じた参加者が、自分の身を守るために丈夫な机の下へ入り、
両手で頭を守る流れを練習します。

公開は`tmpose-kamishibai#583`によるrelease固定だけに依存します。samplesを先に公開し、
docs側はその公開surfaceを使ってcaptureとチュートリアルpublicationを行います。

## 正本と成果物

- `story.kamishibai.yaml`: 完成版の正本
- `starter.kamishibai.yaml`: starter ZIPへ`story.kamishibai.yaml`として収録する初期版
- `addition-kit/`: 揺れている教室、頭を守る見本、YAML断片
- `safety-pose/`: 「頭を守る」ラベルを含む検証済みポーズモデル
- `tutorial-4.0.sb3`: 完成版の自己完結SB3
- `tutorial-story-starter-4.0.zip`: starterとaddition kitをまとめた配布物
- `tutorial-story-addition-kit-4.0.zip`: addition kitだけの配布物
- `public-surfaces.json`: 公開URL、version、integrity、license、公開状態

`pnpm update:tutorial-dsl4`はSB3、ZIP、Web lock、公開surface manifestをatomicに更新します。
通常の`pnpm build`とCIは同じ入力から再生成し、チェックイン済みhashとの一致だけを確認します。

## 防災上の前提

この作品は、教室内に丈夫な机がある場面に限定した練習です。周囲の状況に応じて、落下物や倒れそうな
家具から離れ、安全な空間を確保してください。表現は気象庁「地震について」と消防庁「地震防災マニュアル」
の案内を参考にしています。

- https://www.jma.go.jp/jma/kishou/know/faq/faq7.html
- https://www.fdma.go.jp/relocation/bousai_manual/occ/occurrence111.html

## 公開フラグ

`dsl4-build.config.json`の`publication.enabled`は起動時固定でONです。`4.0.0-rc.5`の固定release
sourceから成果物を再現してブラウザー検証し、`dist/`と作品一覧へ公開します。docs側のcapture完了は
公開条件にしません。問題時はフラグをOFFへ戻して4.0チュートリアルの公開導線だけを停止し、既存3.2成果物を維持します。
