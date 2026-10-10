# 固定したTurboWarp拡張機能

このディレクトリには、3.2版浦島太郎のWeb版（`stories/urashima/web/index.html`）へTurboWarp Packagerが
埋め込む[TurboWarp Extension Gallery](https://extensions.turbowarp.org/)の拡張機能を、取得時点のまま固定して
収録しています。

## 固定する理由

TurboWarp Packagerは、SB3が`https://extensions.turbowarp.org/`の拡張機能を参照していると、build時にその
URLから取得してHTMLへ埋め込みます。取得先は版を固定できないため、上流の翻訳の自動更新だけで生成HTMLが
変わり、artifact lockと一致しなくなります。また、取得に失敗した拡張機能はURLのまま残り、実行時に
ネットワークから読み込むHTMLが警告だけで生成されます。

`scripts/build-packaged-web.ts`は、Packagerへ渡す前にここの複製を`lock.json`のSHA-256で確かめ、Packagerが
bakeするときと同じ形のdata URLへ変換します。Packagerはネットワークから拡張機能を取得しません。
`lock.json`にない拡張機能や、内容が一致しない拡張機能はbuildを止めます。

## 更新

上流の更新を取り込むときだけ、次を実行して複製と`lock.json`を更新し、artifact lockを再生成します。

```bash
pnpm update:turbowarp-extensions
pnpm update:artifacts-lock
```

## ライセンス

各ファイルは取得したままで、先頭の`// License:`行にあるライセンスに従います。`lock.json`にも同じ値を
記録しています。

| ファイル                                            | ライセンス       |
| --------------------------------------------------- | ---------------- |
| `extensions.turbowarp.org/-SIPC-/consoles.js`       | MIT              |
| `extensions.turbowarp.org/Lily/TempVariables2.js`   | MIT AND LGPL-3.0 |
| `extensions.turbowarp.org/Lily/MoreTimers.js`       | MIT AND LGPL-3.0 |
| `extensions.turbowarp.org/text.js`                  | MIT AND MPL-2.0  |
| `extensions.turbowarp.org/local-storage.js`         | MIT AND MPL-2.0  |
| `extensions.turbowarp.org/files.js`                 | MIT AND MPL-2.0  |

作者と出典は各ファイル先頭の`// By:`行と、[TurboWarp/extensions](https://github.com/TurboWarp/extensions)を
参照してください。これらのファイルは本リポジトリのMPL-2.0の対象外です。
