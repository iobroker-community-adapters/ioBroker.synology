# Older changes
## 3.2.0 (2026-10-16)
- (copilot) Adapter requires node.js >= 22 now
- (copilot) Adapter requires admin >= 7.7.22 now
- (copilot) Adapter requires js-controller >= 6.0.11 now
* (McM1957) Dependencies have been updated.

## 3.1.0 (2024-04-07)
* (mcm1957) Adapter requires node.js 18 and js-controller >= 5 now
* (mcm1957) Dependencies have been updated

## 3.0.1 (2023-10-01)
* (Standarduser) A Typo in RegEx for Mac-Address has been corrected.
* (McM1957) Dependencies have been updated.

## 3.0.0 (2023-09-07)
* (Standarduser) Added WOL to awake Synology NAS server
* (bluefox) Only node 16 or higher supported

## 2.1.13 (2022-11-05)
*(McM1957) Code has been prepared for upcoming js-controller release. Reference to utils.controllerDir has been removed. (#198)
*(McM1957) Several base modules have been updated.

## 2.1.12 (2022-10-26)
*(McM1957) Logging of password in clear text has been removed.

## 2.1.11 (2022-10-24)
*(McM1957) The adapter has been adapted to be compatible with node14.

## 2.1.10 (2022-10-23)
*(McM1957) Handling of passwords containing special characters (i.e. a dollar sign) has been fixed (#180)
*(McM1957) Base modules have been updated as suggested by dependabot.

## 2.1.9 (2022-07-01)
* (Apollon77) Try to prevent account locks when using 2FA on restarts of the NAS

## 2.1.8 (2022-06-12)
* (Apollon77) slow down reconnects to the DSM

## 2.1.7 (2022-04-26)
* (Apollon77) Try to prevent account locks when using 2FA on restarts of the NAS

## 2.1.6 (2022-04-04)
* (Apollon77) Fix 2FA

## 2.1.5 (2022-04-03)
* (Apollon77) fix DSM version detection

## 2.1.4 (2022-04-03)
* (arteck) workaround for shutdown and reboot(configure your ssh port in the settings)
* (Apollon77) prevent error when setting FileStation.info.items on start once

## 2.1.1 (2022-03-26)
* (Apollon77) Optimize object type determination and adjustments

## 2.1.0 (2022-03-25)
* IMPORTANT: You need to re-enter the password once after installing this version!
* (Apollon77) Camera snapshots are now also stored in ioBroker storage to be easier used in visualizations!
* (foxriver76) Hide password display in Admin when using Admin5
* (Apollon77) Fix volume description
* (Apollon77) Fix type issues since js-controller 3.3

## 2.0.1 (2021-09-17)
* (MeisterTR) Workaround JSON config Password

## 2.0.0
* (instalator) DSM7 support

## 1.1.3 (2021-08-23)
* (MeisterTR) Fixed 2FA

## 1.1.2 (2021-08-12)
* (MeisterTR) Fixed datatypes
* (MeisterTR) added new ConfigJson (if you use 2FA pleease retype in config)
* (MeisterTR) Fixed snapshot again

## 1.1.1 (2021-08-09)
* (MeisterTR) fix type of uptime
* (MeisterTR) fix broken snapshot link

## 1.1.0 (2021-08-07)
* (MeisterTR) fixes for DSM7
* (MeisterTR) added release-script
* (MeisterTR) change testing
* (MeisterTR) change syno repo to default

## 1.0.1
* (thost96) fix for wrong type number [issue 78](https://github.com/instalator/ioBroker.synology/issues/78)

## 1.0.0
* (instalator) changed name objects in hdd_info [issues 51](https://github.com/instalator/ioBroker.synology/issues/51)
* (Apollon77) BREAKING CHANGE: Please set password new in admin!
* (Apollon77) js-controller 3.0 is now needed minimum!
* (Apollon77 store password now encrypted)

## 0.1.20
* (instalator) fixed error

## 0.1.18
* (instalator) change link for album cover

## 0.1.17
* (instalator) added Sentry plugin support

## 0.1.16
* (instalator) fixed error

## 0.1.15
* (instalator) fixed error in parse Info
* (instalator) fixed api undefined

## 0.1.14
* (instalator) fixed missing [datapoints](https://github.com/instalator/ioBroker.synology/issues/43)
* (instalator) refactoring
* (instalator) Changed the logging of some errors
* (instalator) Changed format session in syno package

## 0.1.11
* (instalator) added motionDetected state
* (SpectreKr*) Adding to FS Sharing

## 0.1.10
* (instalator) fixed copy cover file
* (instalator) fix get packages for DSM 5.x
* (instalator) Added option to select services for receiving data

## 0.1.8
* (instalator) fix error addDownload
* (instalator) fixed listRadios
* (instalator) fixed get cover

## 0.1.7
* (instalator) fixed 2FA
* (instalator) Added setup guide 2FA

## 0.1.6
* (instalator) fix for 2fa
* (instalator) fix error
* (instalator) change error log
* (instalator) fix io-package
* (instalator) fix error status player

## 0.1.4
* (instalator) change for DownloadStation
* (instalator) added playlist favorite radio
* (instalator) added clearPlaylist button
* (instalator) refactoring

## 0.1.3
* (instalator) change obj for ss info fix for cover song 
* (instalator) fix for info.connection 
* (instalator) add 6.2.3 fix for player browser files 
* (instalator) fix for 2FA
* (instalator) fixed error add download 
* (instalator) added DownloadStation task list

## 0.1.2
* (instalator) fixed error

## 0.1.1
* (instalator) added messagebox for snapshot
* (instalator) update readme
* (instalator) added ss link for different streams
* (instalator) fix error
* (instalator) refactoring

## 0.1.0
* (instalator) added HomeMode switch 
* (instalator) change for audiostation 
* (instalator) change for as and ss
* (instalator) added snapshot functional 
* (instalator) fixed systemConfig 
* (instalator) fixed many error

## 0.0.4 (2018-10-07)
* (instalator) Изменен репозиторий библиотеки
* (instalator) Добавлено в конфиг время опроса

## 0.0.3 (2018-01-03)
* (instalator) initial
