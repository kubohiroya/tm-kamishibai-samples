# 作品カード場面画像

作品一覧のカードには4〜5場面を1.6秒ずつ表示する480×270のループGIFを掲載し、クリック後のカルーセルでは各場面のWebPを表示します。GIFは64色・ディザリングなしで最適化しています。実人物のカメラ映像、アカウント情報、連絡先、ローカルファイルパスは含みません。

## 画像ごとの来歴

### 浦島太郎

- 撮影基準: `tmpose-kamishibai@19474e1e49572a5997d1737e63e10bac67a179e9`（4.0.0-rc.6）、`tmpose-kamishibai-samples@a88c89f`を基準に、2026年8月16日の復元画像を組み込んだ作業ツリー
- 撮影条件: Chrome、1280×720表示、実人物のカメラ映像なし。新しい浦島・亀・乙姫の表示を固定した撮影専用の一時台本を使用し、ローディングUIとポーズ待機を除外しています。公開するSB3・台本の内容は変更していません。
- 場面: 浜辺で亀と出会う、亀と進む海中、乙姫の歓迎、玉手箱の受け渡し。実行中UIが重なる画面と、結末を先取りするカーテンコール以降の画面は使用していません。
- ループGIF: `stories/urashima/card-scenes.gif`、480×270、4フレーム、94,007 bytes、SHA-256 `14017e311a55f7294d35a05abd5fdcae821146e14a3e93603a1dddec335353c2`

| WebP | 寸法 | サイズ | SHA-256 |
| --- | ---: | ---: | --- |
| `card-scenes/01.webp` | 1280×720 | 86,190 bytes | `9b4b5669415f3a044e5cdf73a93e14588ce8e56a1446c1751eb87a8ddc243886` |
| `card-scenes/02.webp` | 1280×720 | 94,400 bytes | `3516da92d36753c44c837fcbd36d45b0b795702461fda392a291e8af1f197827` |
| `card-scenes/03.webp` | 1280×720 | 151,552 bytes | `b8bf66ed6ee492cb030f1e587d4e1061e8856de841b729afd2437a025645d9c5` |
| `card-scenes/04.webp` | 1280×720 | 150,396 bytes | `fb7ac92cb00ee84f2946ad3114fe7e08c523a9b498dac953ecfd45079d827c10` |

### my-urashima（ワークショップにおける作業用）

- 撮影基準: `tmpose-kamishibai@19474e1e49572a5997d1737e63e10bac67a179e9`（4.0.0-rc.6）、`tmpose-kamishibai-samples@a88c89f`を基準に、2026年8月16日の復元画像を組み込んだ作業ツリー
- 撮影条件: Chrome、1280×720表示、実人物のカメラ映像なし。共通DSL 3.2ランタイム上で、新しい浦島・亀・乙姫・魚の表示を固定した撮影専用の一時台本を使用しています。公開するSB3・台本の内容は変更していません。
- 場面: 浜辺、亀と進む海中、正規化後の乙姫による歓迎、玉手箱の受け渡し。結末を先取りするカーテンコールは使用していません。
- ループGIF: `stories/my-urashima/card-scenes.gif`、480×270、4フレーム、96,518 bytes、SHA-256 `1b33afc41316e906fafa8a97d8ff32e155e2cf06d7689a5b9c104c1e76f0c83d`

| WebP | 寸法 | サイズ | SHA-256 |
| --- | ---: | ---: | --- |
| `card-scenes/01.webp` | 1280×720 | 86,352 bytes | `c0794984e3f8034ddeb4aedfbd83cfbf1ce9be8203ad8220ef41598fb107103e` |
| `card-scenes/02.webp` | 1280×720 | 94,400 bytes | `3516da92d36753c44c837fcbd36d45b0b795702461fda392a291e8af1f197827` |
| `card-scenes/03.webp` | 1280×720 | 157,440 bytes | `769042e304dff8f433d95d8d0ccfb758482e660e18e9e2caacd135757ce214e2` |
| `card-scenes/04.webp` | 1280×720 | 150,396 bytes | `fb7ac92cb00ee84f2946ad3114fe7e08c523a9b498dac953ecfd45079d827c10` |

### 地震だ！頭を守ろう（DSL 4.0チュートリアル）

- 撮影基準: タイトルは`tmpose-kamishibai@19474e1e49572a5997d1737e63e10bac67a179e9`（4.0.0-rc.6）。ほか4枚は`tmpose-kamishibai-docs/docs/images/tutorials/dsl4/play/`の`tutorial-play-04`から`07`
- 撮影条件: Chrome、1280×720、合成人物fixture、実人物のcamera映像なし。タイトル画面下部の連絡先行は単色背景で除外しています。
- 場面: rc.6タイトル、camera確認、ポーズ認識、ポーズ成功、達成メッセージ
- ループGIF: `stories/tutorial/card-scenes.gif`、480×270、5フレーム、82,272 bytes、SHA-256 `9c1af3b448a1c5adff65f8f4b463d23d0eaf2744fb2b05c1467d8b72c1009257`

| WebP | 寸法 | サイズ | SHA-256 |
| --- | ---: | ---: | --- |
| `card-scenes/01.webp` | 1280×720 | 35,554 bytes | `80d9d0ccc322b9d9a1be38d588c1a32b98a79f373dacc51884d05d78e227ae2a` |
| `card-scenes/02.webp` | 1280×720 | 35,070 bytes | `92abac9c8a76b6c1e8c6e29464cfe635cd6b6bb70bf961f6a2fb1aa53b8b06b3` |
| `card-scenes/03.webp` | 1280×720 | 32,978 bytes | `ccb174a3e904902cf97bc21b9374b974a7711a3a8afec7c8a34b022407a027ad` |
| `card-scenes/04.webp` | 1280×720 | 16,662 bytes | `8104143d8d297724b463dd4e7989f8cc352ad940f602edc73727b46e077e4632` |
| `card-scenes/05.webp` | 1280×720 | 33,164 bytes | `351655dbaf80fcccb536809f29254179d0f933fca364d8bd8cd1f0a3d07c7409` |

## 権利とライセンス

画面内のTMPose紙芝居runtime、UI、台本、背景、Actor画像などには、各作品のライセンス・利用条件が適用されます。

- [浦島太郎・my-urashimaのライセンス](stories/urashima/LICENSES.md)
- [DSL 4.0チュートリアルのライセンス](stories/tutorial/LICENSES.md)

スクリーンショットとしての場面選択、切り出し、キャプションおよびWebP変換物の権利者はHiroya Kuboです。この部分は[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)（CC BY-SA 4.0）で提供します。この表示は、画面内のMPL-2.0対象要素や第三者素材をCC BY-SA 4.0として再許諾するものではありません。
