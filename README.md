# SQL BI

## Русское описание

SQL BI — это portable HTML-инструмент для построения SQL-запросов по структуре базы 1С, выгруженной в XLSX или MXL.

Проект создан для сценариев Power BI и BI-аналитики, когда нужно быстро выбрать нужные объекты 1С, документы, справочники, табличные части и поля, а затем получить готовый SQL-запрос к SQL Server.

### Основная цель

Упростить работу с технической структурой 1С и помочь собирать корректные SQL-запросы без ручного поиска внутренних имен таблиц и полей вроде `_Document...`, `_Reference...`, `_Fld...`, `_IDRRef`.

### Что умеет инструмент

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

### Как использовать

1. Откройте `index.html` или `sql_bi_v9.html` в браузере.
2. Загрузите файл структуры 1С в формате `.xlsx` или `.mxl`.
3. Найдите нужный объект или поле через поиск.
4. Отметьте поля чекбоксами.
5. При необходимости раскройте справочники и выберите их поля, например `Наименование`, `Код`, `Фамилия`, `Имя`.
6. Настройте базу, схему, период и режим плоской таблицы.
7. Скопируйте готовый SQL.

### Для чего полезно

- Подготовка SQL-запросов для Power BI.
- Быстрый анализ структуры 1С.
- Поиск внутренних имен таблиц и полей.
- Сбор плоских таблиц из документов и табличных частей.
- Работа со связанными справочниками и перечислениями.

---

## English Description

SQL BI is a portable HTML tool for building SQL queries from 1C database metadata exported as XLSX or MXL.

The project is designed for Power BI and BI analytics workflows where users need to select 1C objects, documents, catalogs, tabular sections, and fields, then generate a ready-to-use SQL Server query.

### Main Goal

The goal is to make 1C SQL metadata easier to work with and reduce manual lookup of internal table and field names such as `_Document...`, `_Reference...`, `_Fld...`, and `_IDRRef`.

### Features

- Loads 1C metadata from `.xlsx` or `.mxl` files.
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

### How to Use

1. Open `index.html` or `sql_bi_v9.html` in a browser.
2. Load a 1C metadata file in `.xlsx` or `.mxl` format.
3. Search for the required object or field.
4. Select fields using checkboxes.
5. Expand linked catalogs if needed and select fields such as `Description`, `Code`, `Last Name`, or `First Name`.
6. Configure database name, schema, date period, and flattened-table mode.
7. Copy the generated SQL query.

### Useful For

- Preparing SQL queries for Power BI.
- Exploring 1C database structure.
- Finding internal SQL table and field names.
- Building flattened tables from documents and tabular sections.
- Working with linked catalogs and enums.

## Version

Current published version: `v9`.
