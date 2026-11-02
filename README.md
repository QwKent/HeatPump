# MWDT — Калькулятор теплового насоса

**MWDT (HeatPump)** — это Android-приложение для расчета и подбора теплового насоса для дома. Приложение помогает определить, подходит ли конкретная модель насоса под параметры здания, рассчитывает теплопотери, реальный COP, SCOP и экономическую выгоду по сравнению с газовым котлом.

## Особенности
- **Расчет теплопотерь:** учитывает площадь, высоту потолков, утепление, окна, вентиляцию и регион.
- **Подбор мощности:** проверяет, справится ли насос с нагрузкой (с учетом запаса).
- **Реальный COP и SCOP:** расчет коэффициента производительности в зависимости от источника тепла и температуры подачи.
- **Кривая подачи:** генерация графика температур для настройки контроллера насоса.
- **Экономика:** сравнение затрат с газовым котлом, расчет окупаемости и построение графика на 10 лет.
- **Экспорт:** сохранение отчета в PDF и выгрузка данных в JSON.

## Технологии
Приложение построено по гибридной схеме:
- **Frontend:** HTML5, CSS3, JavaScript (Chart.js для графиков, jsPDF для экспорта в PDF).
- **Backend (Android):** Kotlin, WebView для отображения интерфейса, JavascriptInterface для связи с файловой системой.

## Структура проекта
```text
├── app/
│   ├── src/main/
│   │   ├── assets/          # Веб-интерфейс (index.html, styles.css, app.js)
│   │   ├── java/...         # Kotlin код (MainActivity.kt, FileSaver.kt)
│   │   └── AndroidManifest.xml
│   └── build.gradle.kts
├── gradle/
├── build.gradle.kts
├── settings.gradle.kts
└── README.md
```

# Как собрать
## Склонируйте репозиторий:

```bash
git clone https://github.com/QwKent/HeatPump.git
```
Откройте проект в Android Studio.

Дождитесь синхронизации Gradle.

Нажмите Run для запуска на эмуляторе или реальном устройстве.

# Лицензия
## Этот проект распространяется под лицензией MIT. Подробности в файле LICENSE.




### 2. Файл лицензии `LICENSE` (MIT)


```text
MIT License

Copyright (c) 2026 QwKent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
