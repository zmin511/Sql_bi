# Changelog
## 0.2.4 - 2026-08-19

### Promedica Light UI
- Production `index.html` moved to the Promedica light corporate design system: central colour, surface, radius, focus and motion tokens.
- Added textual product identity for Promedica SQL BI without inventing a logo asset.
- Restyled cards, forms, actions, tree metadata, relationship graph and SQL workspace while preserving the existing DOM contracts and canonical runtime.
- Added responsive mobile treatment, visible keyboard focus and reduced-motion handling.

## 0.2.3 - 2026-08-11

### Added and changed
- The current-query graph now presents canonical aliases as the primary node identifier, with human object names, physical tables, semantic roles, compact field/filter counts, and readable physical JOIN-column labels.
- Focus details retain canonical SQL while adding structured alias, object, role, selected-field, and filter context.

## 0.2.2 - 2026-07-30

### Added and changed
- Canonical SQL generation now uses one canonical query plan for selections, aliases and JOINs.
- Reference validation, deterministic joins, shared-prefix deduplication, header/detail handling and blocked relationships are covered by the canonical flow.
- The portable single-file build has deterministic source and embedded-payload SHA-256 checks with stale-block detection.
- Query relationship visualization supports tree, graph and split modes with all, active, SQL and error filters.
- Project persistence stores view.visualization and remains backward compatible with older project files.

### Release remediation
- Removed the public mutable production test API; test hooks are VM-only.
- Removed the duplicate visualization normalizer and the unreachable legacy SQL/JOIN renderer.
- Replaced formal test-count assertions with meaningful production scenarios.

### Verification
- Scenario suites: query plan 40; production core embed 30; production UI characterization 40; production query-plan parity 20; production query graph 10; production project visualization 10; reference resolution parity 15; reference chain parity 17; reference SQL integration 28; selection context integration 13; table-part header parity 17.
- Portable checks: 5. Full npm test passed.


## 0.2.1 — 2026-07-22

### Добавлено
- Генерация готового Power Query (M-кода) через `Sql.Database()` и `Value.NativeQuery()`.
- Поле SQL Server, сохраняемое и восстанавливаемое в проекте `.sqlbi`.
- Экспорт Power Query в файл `.pq` в кодировке UTF-8 с BOM.
- Экспорт сформированного SQL-запроса в файл `.sql` в кодировке UTF-8 с BOM.
- Сохранение полного проекта в локальный переносимый файл `.sqlbi`.
- Загрузка проекта без повторного выбора исходного MXL/XLSX.
- Загрузка XML-выгрузок 1С в формате `ValueStorage` со сжатым табличным документом.
- В проект включаются структура, исходные и синтетические выбранные поля, булевы фильтры, режим «Плоская», период, база, схема, ручной `FROM`, глубина справочников, режим связей и состояние дерева.
- В интерфейс возвращены явные поля базы данных, схемы и ручного `FROM`.
- Добавлен чистый модуль `src/core/project.js` для сериализации и строгой проверки формата проекта.

### Безопасность
- Строки сервера, базы данных и SQL экранируются по правилам языка M, включая кавычки, переносы и символ `#`.
- Импорт принимает только формат `sql-bi-project` версии `1`.
- Повреждённый JSON, пустая структура, строки без ID и неизвестная версия формата блокируются.
- Устаревшие выбранные ID и фильтры, отсутствующие в сохранённой структуре, не восстанавливаются.
- Загрузка проекта остаётся полностью локальной и не выполняет сетевых запросов.

### Проверено
- Модульные тесты: `17/17`.
- Синтаксис встроенного JavaScript: успешно.
- Реальный MXL: `12 452` строки.
- Реальный XML ValueStorage от 22.07.2026: `12 505` строк.
- SQL до сохранения и после загрузки проекта: идентичен.

## 0.2.0 — 2026-07-21

### Статус
- Первый стабильный автономный релиз SQL BI.
- Рабочий файл приложения: `index.html`.
- SHA-256 релизного HTML: `ce5760492552b8bba57ab09ec85dfc1f00eeb9aa3049c4d64d52355d74bb2818`.

### Исправлено
- Выбор разрешён только для реальных физических SQL-полей.
- Связанные справочники разрешаются только при однозначном соответствии; fallback на первый найденный объект удалён.
- Исправлены границы прошлых и будущих относительных периодов и ручного диапазона дат.
- Сохранены точные числовые типы `decimal(p,s)`, UUID для `RRef`, булевы значения и преобразование дат 1С.
- Связь шапки документа и одной табличной части строится только после подтверждённого разрешения H–T.
- Независимые физические таблицы и две табличные части одной шапки автоматически не смешиваются.
- При повторной загрузке MXL полностью очищается состояние, включая режим «Плоская».

### Автономность
- SheetJS/XLSX 0.18.5 встроена непосредственно в HTML.
- Удалена зависимость от CDN.
- Отсутствуют автоматически загружаемые внешние JavaScript, CSS, шрифты и изображения.
- Приложение открывается с локального диска и работает без интернета.

### Проверено
- Регрессия step01–step08: `276/276`.
- Финальные интеграционные проверки: `54/54`.
- Общий результат: `330/330`.
- Safety-sweep физических полей: `10 827/10 827`.
- Реальный MXL: разобрано `12 452` строки.
- Ручной запуск сформированного SQL на базе 1С: успешно.

### Ограничения
- Генерируется SQL Server SQL для структуры базы 1С.
- Автоматические JOIN разрешены только для однозначно подтверждённых связей.
- Две табличные части одной шапки совместно не объединяются.
- UNION, произвольные JOIN, экспорт SQL/JSON и серверная часть не входят в релиз.

## 0.1.9.1 — 2026-06-05

### Изменено
- В корне проекта оставлен один рабочий HTML-файл: `index.html`.
- Версия в интерфейсе и `VERSION` обновлена до `0.1.9.1`.
- Старые и промежуточные HTML-копии перенесены в `backups/`.
- README обновлен под правило: версии фиксируются в интерфейсе, `VERSION`, `CHANGELOG.md`, git history и backup-файлах, а не отдельными HTML-файлами в корне.

### Перенесено в backups
- `sql_bi_v9.html` -> `backups/sql_bi_v9_legacy.html`
- `sql_bi_v0.1.9.html` -> `backups/sql_bi_v0.1.9_release.html`
- `sql_bi_v0.2.0-dev.html` -> `backups/sql_bi_v0.2.0-dev_seed.html`

### Проверено
- JavaScript в `index.html` компилируется.

### Риски
- Логика SQL-генерации не менялась.

### Откат
- Вернуть нужную HTML-копию из `backups/` в `index.html`.

## 0.1.9 — 2026-06-05

### Добавлено
- Экспорт сформированного SQL-запроса в файл `.sql` в кодировке UTF-8 с BOM.
- Опубликована текущая стабильная portable-версия SQL BI.
- Зафиксирована рабочая точка входа `index.html`.
- Добавлена отдельная версия `sql_bi_v0.1.9.html`.
- Добавлен файл `VERSION` со значением `0.1.9`.
- Создан baseline backup: `backups/sql_bi_v0.1.9_2026-06-05_baseline.html`.

### Текущее состояние
- Загрузка структуры 1С из XLSX/MXL.
- Дерево объектов, документов, справочников, перечислений, регистров и полей.
- Выбор полей через чекбоксы.
- Проваливание в связанные справочники и перечисления.
- Генерация SQL Server SELECT.
- LEFT JOIN к шапке документа и справочникам.
- Режим плоской табличной части.
- Относительный период по месяцам и дням.
- Диагностика связей.

### Проверено
- JavaScript в `index.html` и `sql_bi_v0.1.9.html` компилировался перед публикацией версии 0.1.9.
- Версия опубликована в GitHub-репозитории.

### Риски
- Проект пока остается single-file HTML/JS, бизнес-логика смешана с UI.
- Нет автоматических тестов ядра SQL-генератора.
- Диагностика связей 1:N пока предупреждающая, без полноценного режима агрегации.

### Откат
- Использовать `backups/sql_bi_v0.1.9_2026-06-05_baseline.html`.
- Либо взять файл `sql_bi_v0.1.9.html`.

## 0.2.0-dev — 2026-06-05

### Назначение
- Рабочая dev-копия для следующего этапа развития без изменения стабильной версии 0.1.9.

### Выполнено
- Добавлена начальная модульная структура `src/core/` для чистой бизнес-логики без привязки к DOM.
- Вынесены базовые функции нормализации строк структуры 1С, восстановления дерева, определения таблиц, типов, дат и SQL CAST.
- Добавлен чистый модуль `src/core/sqlGenerate.js` для генерации SQL и диагностики связей без DOM.
- Добавлен `package.json` со скриптом `npm test`.
- Добавлен набор smoke/unit-тестов в `tests/run-tests.js` для следующей безопасной доработки генератора.

### План
- Стабилизировать структуру проекта.
- Выделить чистые функции ядра.
- Добавить тестируемые функции для дерева, справочников, дат, CAST и SQL-генерации.
- Расширить диагностику связей.
- Подготовить режимы работы со связями 1:N.

### Проверено
- `npm test` — 12 тестов пройдено.

### Риски
- `index.html` пока не подключен к новым core-модулям; перенос идет пошагово, чтобы не сломать portable-запуск приложения.
