# Пайплайн генерации иконок (черты и расы)

Этот пайплайн делает две вещи:
1. Считает, каких иконок не хватает в модуле.
2. Готовит JSONL-пачки для массовой генерации через CLI `image_gen.py`.

Скрипт: `tools/icon-pipeline.py`

## 1) Аудит покрытия

```powershell
python tools/icon-pipeline.py audit
```

Опционально:

```powershell
python tools/icon-pipeline.py audit --show-examples 30
python tools/icon-pipeline.py audit --no-include-race-features
```

Манифест по умолчанию пишется в:
`tmp/imagegen/icon-audit-manifest.json`

## 2) Подготовка батч-джобов для черт

```powershell
python tools/icon-pipeline.py jobs `
  --category feats `
  --missing-only `
  --chunk-size 40 `
  --print-commands
```

## 3) Подготовка батч-джобов для рас и расовых особенностей

```powershell
python tools/icon-pipeline.py jobs `
  --category races `
  --missing-only `
  --include-race-features `
  --chunk-size 40 `
  --print-commands
```

JSONL-файлы по умолчанию складываются в:
`tmp/imagegen/jobs`

## 4) Запуск генерации пачек

Нужен `OPENAI_API_KEY`.

Пример (одна пачка):

```powershell
python "$env:CODEX_HOME\skills\.system\imagegen\scripts\image_gen.py" generate-batch `
  --input "D:\FoundryVTT\Data\modules\rebreya-main\tmp\imagegen\jobs\feats-icons-001.jsonl" `
  --out-dir "D:\FoundryVTT\Data\modules\rebreya-main\templates\icons\Feats" `
  --concurrency 4 `
  --size 1024x1024 `
  --quality medium
```

Для `races-icons-*.jsonl` указывай:
`--out-dir D:\FoundryVTT\Data\modules\rebreya-main\templates\icons\Races`

## Важные заметки

- Иконка матчится по имени файла (без расширения), после нормализации текста.
- Поэтому файл должен называться максимально близко к имени сущности (скрипт это делает сам).
- Стиль в промптах уже унифицирован: тёмное фэнтези, золотая рамка, оранжевые акценты, без текста.
- После генерации можно повторно запускать `audit`, чтобы видеть остаток пропусков.
