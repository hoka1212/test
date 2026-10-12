# PIT WALL

Фанатский сайт о Формуле 1 в футуристичном стиле: таймер до следующего Гран-при, календарь сезона с силуэтами трасс, личный и командный зачёт, дуэль пилотов и две мини-игры.

- **Lights Out**: тест реакции на старт с пятью красными огнями.
- **Призрачный круг**: угадай трассу по силуэту. 78 трасс и 158 конфигураций, которые использовались в Гран-при с 1950 года. Режимы: «Сезон», «Вся история» и «Фантом».

## Запуск

Это статический сайт без сборки: открой `index.html` или включи GitHub Pages для ветки `main`.
Таблицы и победителей сайт сам обновляет в браузере через Jolpica F1 API. Если API недоступен, показывает данные, сохранённые при сборке.

## Обновление данных

```
pip install svgelements
git clone https://github.com/MisterSix2295/f1-circuits-svg
git clone https://github.com/bacinger/f1-circuits
python3 tools/build_data.py f1-circuits-svg f1-circuits 2026
```

## Источники

- Схемы трасс: [f1-circuits-svg](https://github.com/MisterSix2295/f1-circuits-svg) (Jules Roy, MIT) и [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT, трасса Madring).
- Данные сезона: [Jolpica F1 API](https://github.com/jolpica/jolpica-f1).

Проект не связан с Formula 1 и FIA.
