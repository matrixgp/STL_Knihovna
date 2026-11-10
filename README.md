# STL Knihovna

Lokální „MakerWorld“ pro tvoje STL: přehledná mřížka všech projektů ze složky `D:\Programy\3D Print\`, 3D náhled, vyhledávání, štítky, oblíbené a stav tisku.

## Spuštění

1. Dvojklik na **`run.bat`** (potřebuje .NET 10 SDK; pro jinou verzi změň `TargetFramework` v `STL_Knihovna.csproj`).
2. Otevře se prohlížeč na `http://127.0.0.1:5173`. Okno konzole nech běžet; zavřením aplikaci ukončíš.

Složku s modely změníš přímo v aplikaci: klikni na cestu vpravo nahoře → „Změnit“, napiš cestu nebo ji vyber v seznamu složek. Volba se uloží do `config.json` (`"root"`) a posledních 8 složek se zapamatuje. Jde to i argumentem: `run.bat "E:\Jina\Slozka"`.

Alternativa bez .NET (stejné API, jen Node.js): `node dev\server.mjs`.

## Jak se skládají projekty

- Podsložka s modely = jeden projekt (včetně `files/`, `images/` apod.).
- Složka bez vlastních modelů, uvnitř které jsou další projekty, je **kategorie** (např. `Vánoce`, `Arduino`) – název se stane štítkem.
- Volné soubory v kořeni (a ve složkách ze `collections`) se seskupí podle názvu: `Krabicka_x.step`, `Krabicka_x_telo.stl`, `Krabicka_x_vicko.stl` → jeden projekt.
- Ignoruje se `desktop.ini`, `*.FCBak`, složky začínající `~` nebo `.`.

## config.json

| klíč | význam |
|---|---|
| `root` | složka s modely |
| `port`, `openBrowser` | port a automatické otevření prohlížeče |
| `slicer` | cesta k `.exe` slicer (např. Bambu Studio); prázdné = výchozí aplikace Windows pro daný soubor |
| `bed` | rozměry podložky v mm (pro kontrolu, jestli se model vejde) |
| `ignore` | cesty (relativní ke kořeni), které se mají přeskočit |
| `collections` | složky, jejichž volné soubory jsou samostatné projekty (jako kořen) |
| `downloadedFolders` | složky, jejichž projekty se automaticky označí jako „Stažené“ |
| `autoTags` | automatické štítky podle klíčových slov v názvu |

## Kde jsou data

- `data/roots/<kód>/meta.json` – oblíbené, štítky, poznámky, stav tisku, přejmenování (klíč = cesta projektu). Každá složka s modely má vlastní podsložku, v `root.txt` je napsáno, ke které patří.
- `data/roots/<kód>/thumbs/` – cache náhledů (smaž ji, pokud chceš náhledy vygenerovat znovu).

Soubory s modely aplikace nikdy nemění ani nemaže.

## Náhledy

Pořadí: obrázek ze složky projektu (např. `images/…preview…jpg`) → vykreslení největšího STL → náhled vložený do 3MF → vykreslení STEP (do 25 MB). Vygenerované náhledy se uloží do `data/thumbs`, takže příště se načtou okamžitě.

## Struktura

```
Program.cs          tenký server (.NET minimal API)
wwwroot/js/         projects.js (seskupování), app.js (UI), viewer.js (3D), thumbs.js (náhledy)
wwwroot/lib/three/  three.js (lokální kopie, funguje offline)
wwwroot/lib/occt-import-js/  převod STEP → 3D (OpenCascade ve WebAssembly, licence LGPL – viz přiložené soubory)
dev/server.mjs      stejné API v Node.js
```

## Náhled STEP

Soubory `.step` / `.stp` se v detailu projektu zobrazí stejně jako STL (jsou v pásu pod náhledem). Převod běží v prohlížeči, u velkých souborů (desítky MB) může trvat několik sekund. Barvy a materiály z CADu se nepřenášejí.

## Spustitelný exe (publish.bat)

`publish.bat` jedním kliknutím vytvoří samostatný `dist\STL_Knihovna\STL_Knihovna.exe` s ikonou (nepotřebuje nainstalovaný .NET). Při každém úspěšném sestavení zvýší číslo v `build.txt`; to se objeví ve vlastnostech exe (Podrobnosti → verze `1.0.<číslo>`), v konzoli při startu a v patičce aplikace. Složku `dist\STL_Knihovna` si můžeš zkopírovat kamkoli – exe, `wwwroot` a `config.json` musí zůstat pohromadě, data (poznámky, náhledy) se ukládají do podsložky `data`. Ikonu znovu vygeneruješ příkazem `python dev\make_icon.py`.
