# SQL BI

## Назначение

SQL BI — portable HTML-инструмент для визуального построения SQL Server-запросов по структуре базы 1С/SQL, выгруженной в XLSX или MXL.

Инструмент помогает собирать BI-витрины для Power BI и других BI-отчетов: пользователь загружает структуру 1С, видит дерево документов, справочников, перечислений, регистров, табличных частей и полей, выбирает нужные поля, а приложение генерирует SQL.

Главная идея проекта — упростить работу с техническими именами 1С (`_Document...`, `_Reference...`, `_Fld...`, `_IDRRef`) и при этом не скрывать важные риски: связи 1:N, размножение строк, JOIN к шапке документа, JOIN к справочникам и особенности дат 1С.

## Что умеет

- Загружает структуру 1С из `.xlsx` или `.mxl`.
- Показывает объекты и поля в виде единого дерева.
- Восстанавливает вложенность по уровню строк.
- Позволяет выбирать поля документов, справочников, перечислений, регистров и табличных частей.
- Поддерживает проваливание в связанные справочники и перечисления.
- Генерирует `SELECT` с человекочитаемыми алиасами.
- Автоматически определяет SQL-таблицу для выбранного поля.
- Строит `LEFT JOIN` к шапке документа и связанным справочникам.
- Поддерживает плоскую выдачу: строки табличной части + повторяющиеся поля шапки.
- Учитывает особенность дат 1С через `DATEADD(YEAR, -2000, ...)`.
- Позволяет задавать относительный период по месяцам и дням: за последние и на предстоящие.
- Ограничивает глубину проваливания в справочники и защищает от циклов.
- Показывает диагностику связей и построенных JOIN.

## Как запустить

Откройте в браузере:

- `index.html` — единственный рабочий файл приложения в корне проекта.

Установка не требуется. Приложение работает как один HTML-файл.

## Разработка

Пользовательская версия остается portable HTML-приложением в `index.html`.

Для развития проекта по карте доработок часть бизнес-логики постепенно выносится в чистые модули:

- `src/core/normalize.js` — нормализация строк структуры 1С.
- `src/core/tree.js` — восстановление дерева и вложенности.
- `src/core/tableDetect.js` — определение SQL-таблиц 1С.
- `src/core/types.js` — распознавание ссылок, дат и типов.
- `src/core/dates.js` — выражения дат 1С и относительных периодов.
- `src/core/casts.js` — SQL CAST для UUID, дат, булевых и числовых полей.
- `src/core/sqlGenerate.js` — генерация SQL, JOIN и диагностики связей без привязки к интерфейсу.

Проверка ядра:

```bash
npm test
```

## Как подготовить XLSX/MXL

Файл структуры должен содержать таблицу с колонками:

- `Объекты`
- `Тип`
- `Список типов`
- `Уровень`
- `Полное имя`
- `Номер картинки`
- `Метаданные`
- `Внутреннее имя`

MXL-файл может быть стандартной выгрузкой табличного документа 1С. Приложение читает его напрямую и восстанавливает ту же структуру, что используется в XLSX.

## Как построить первый запрос

1. Откройте `index.html`.
2. Загрузите `.xlsx` или `.mxl` со структурой 1С.
3. Найдите нужный документ, справочник, регистр или поле через поиск.
4. Отметьте поля чекбоксами.
5. Если поле является ссылкой на справочник, раскройте его и выберите нужные поля: `Наименование`, `Код`, `Фамилия`, `Имя`, `Отчество` и т.д.
6. При необходимости выберите поле даты и относительный период.
7. Для табличной части включите режим `Плоская`, если нужно повторить поля шапки в каждой строке табличной части.
8. Скопируйте готовый SQL.

## Как работают документы и табличные части

Если выбранное поле находится внутри табличной части `_Document..._VT...`, базовой таблицей считается именно табличная часть, а не шапка документа.

Если выбраны поля шапки и табличной части одного документа, приложение строит запрос от табличной части и добавляет `LEFT JOIN` к шапке:

```sql
FROM [dbo].[_DocumentXXX_VTYYY] AS T
LEFT JOIN [dbo].[_DocumentXXX] AS H
  ON T.[_DocumentXXX_IDRRef] = H.[_IDRRef]
```

В режиме `Плоская` строки табличной части сохраняются, а выбранные поля шапки повторяются в каждой строке.

## Как работают справочники

Если поле является ссылкой (`RRef`) или имеет тип `Справочник.*` / `Перечисление.*`, его можно раскрыть прямо в дереве.

Выбранные поля справочника добавляются в SQL через `LEFT JOIN`:

```sql
LEFT JOIN [dbo].[_ReferenceXXX] AS R1
  ON R1.[_IDRRef] = T.[_FldYYYRRef]
```

Алиасы в `SELECT` формируются человекочитаемо, например:

```sql
R1.[_Fld6450] AS [Клиент.Фамилия]
R1.[_Fld6452] AS [Клиент.Имя]
```

## Как работают даты 1С

Для `_Date_Time` применяется смещение:

```sql
DATEADD(YEAR, -2000, T.[_Date_Time])
```

Это используется одинаково в:

- `SELECT`
- `WHERE`
- `ORDER BY`

Относительный период можно задавать месяцами и днями, отдельно за прошлый и будущий период.

## Как работают связи 1:N

Проект не должен автоматически схлопывать строки. `DISTINCT` не используется по умолчанию.

Если выбранные связи могут размножить строки, приложение должно показывать предупреждение в диагностике. Агрегация через `STRING_AGG` планируется как отдельный явный режим, но не должна включаться автоматически.

## Ограничения версии 0.1.9.1

- Проект пока остается single-file HTML/JS.
- Бизнес-логика SQL-генератора пока смешана с UI.
- Есть первые тесты ядра, включая стартовые сценарии генерации SQL; логика `index.html` еще не полностью перенесена в `src/core/`.
- Режимы 1:N пока ограничены диагностикой и сохранением строк.
- Нет сохранения пользовательских шаблонов.
- Нет экспорта `.sql`, `.json` и паспорта запроса.
- Нет режима `CREATE OR ALTER VIEW`.

## Версионирование и откат

Текущая стабильная версия: `0.1.9.1`.

Правила версий:

- мелкая правка без изменения логики: `0.1.9.1`, `0.1.9.2`;
- функциональная доработка: `0.2.0`;
- крупный рефакторинг или архитектурное изменение: `0.3.0`;
- стабильная протестированная версия: `1.0.0`.

Перед изменениями нужно:

1. Создать backup текущего рабочего файла.
2. Не хранить версионные копии HTML в корне проекта.
3. Обновить номер версии в интерфейсе.
4. Обновить `CHANGELOG.md`.
5. Зафиксировать, что изменено и что проверено.

Текущий baseline:

```text
backups/sql_bi_v0.1.9_2026-06-05_baseline.html
backups/sql_bi_v0.1.9_release.html
backups/sql_bi_v0.2.0-dev_seed.html
```

В корне репозитория должен оставаться один рабочий HTML-файл: `index.html`. Исторические и промежуточные HTML-копии нужно складывать в `backups/`.

## История версий

См. `CHANGELOG.md`.

## План развития

Ближайшие этапы:

1. Стабилизировать baseline 0.1.9.
2. Выделить ядро SQL-генератора в чистые функции.
3. Добавить тесты для дерева, таблиц, справочников, дат, CAST и SQL.
4. Улучшить диагностику связей.
5. Добавить режимы для 1:N:
   - сохранять строки;
   - только предупреждать;
   - агрегировать через `STRING_AGG`;
   - формировать отдельные SELECT-блоки.
6. Добавить анализ структуры.
7. Добавить мастер запросов.
8. Добавить сохранение шаблонов в `localStorage`.
9. Добавить экспорт SQL, JSON и паспорта запроса.
10. Добавить режим `CREATE OR ALTER VIEW`.

---

# SQL BI — English

## Purpose

SQL BI is a portable HTML tool for visually building SQL Server queries from 1C/SQL metadata exported as XLSX or MXL.

It is intended for Power BI and BI reporting workflows: users load 1C metadata, browse a tree of documents, catalogs, enums, registers, tabular sections and fields, select the required fields, and get a generated SQL query.

The main goal is to make technical 1C names such as `_Document...`, `_Reference...`, `_Fld...`, and `_IDRRef` easier to work with, while keeping important SQL risks visible: 1:N relationships, row multiplication, document-header joins, reference joins, and 1C date offsets.

## Features

- Loads 1C metadata from `.xlsx` or `.mxl`.
- Displays objects and fields as a single tree.
- Restores hierarchy from row levels.
- Allows selecting document, catalog, enum, register, and tabular-section fields.
- Supports drilling into linked catalogs and enums.
- Generates `SELECT` statements with readable aliases.
- Automatically detects the SQL table for selected fields.
- Builds `LEFT JOIN` clauses for document headers and linked reference tables.
- Supports flattened output: tabular-section rows with repeated document-header fields.
- Handles 1C date offset with `DATEADD(YEAR, -2000, ...)`.
- Supports relative date filters by months and days, both past and future.
- Limits reference drill-down depth and protects against cyclic references.
- Shows diagnostics for detected relationships and generated JOINs.

## How to Run

Open in a browser:

- `index.html` — the single working application file in the project root.

No installation is required. The application is a single HTML file.

## Current Version

Stable version: `0.1.9.1`.

Historical and development HTML copies are stored in `backups/`.

See `CHANGELOG.md` for version history.
