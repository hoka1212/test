# PIT WALL

Фанатский сайт о Формуле 1.

**Главная** (`index.html`, светлый дизайн):
- 3D-болид сезона 2026 в шапке. Он поворачивается за курсором, по нажатию меняется команда, при прокрутке камера облетает машину.
- Пролёт по трассе ближайшего Гран-при.
- Календарь сезона с силуэтами трасс.
- Личный зачёт и Кубок конструкторов.
- Дуэль пилотов.
- Мини-игры Lights Out и «Призрачный круг».

**Анатомия болида** (`anatomy/`, тёмный дизайн):
- 28 настоящих машин XXI века по семи эпохам регламента (2001–2026).
- Выбор команды и ливреи: оригинал, голый карбон, белая модель для аэротрубы, хром или свой цвет.
- Разбор на детали с описанием каждой.

## Запуск

Это статический сайт без сборки. Для GitHub Pages: Settings → Pages → Deploy from a branch → `main` / `(root)`.
На бесплатном тарифе GitHub Pages работает только для публичных репозиториев.

Локально: `python3 -m http.server`, затем открой `http://localhost:8000`. Модели грузятся через fetch, поэтому `file://` не подойдёт.

## Обновление данных

```
pip install svgelements
python3 tools/build_data.py <f1-circuits-svg> <bacinger/f1-circuits> 2026      # трассы и сезон
SKETCHFAB_TOKEN=... python3 tools/fetch_models.py                               # 3D-модели
```

## Источники

- 3D-модели болидов: Sketchfab, лицензия CC BY 4.0. Авторы перечислены в `data/model-credits.json` и внизу страницы «Анатомия».
- Схемы трасс: [f1-circuits-svg](https://github.com/MisterSix2295/f1-circuits-svg) (Jules Roy, MIT) и [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT).
- Данные сезона: [Jolpica F1 API](https://github.com/jolpica/jolpica-f1).
- 3D-движок: [three.js](https://threejs.org) (MIT).

Проект не связан с Formula 1 и FIA. Названия команд и спонсоров на ливреях принадлежат их владельцам.
