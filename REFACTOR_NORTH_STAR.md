stationthisbot

a web application that,
using an internal and external api,
interfaces with telegram, discord, a web-interface frontend,
to allow users to spend their points purchased with crypto,
to perform ai image video audio generation, 
using our main comfyuideploy service,
as well as other 3rd party services like vidu, tripo, 11labs, and so on,

we offer other services like model training, nft collection creation, prompt engineering, and more.

Right now, the old, operational codebase lives mostly in utils/bot/ and runs from server.js 
it is inextricably tied to the operation of a telegram bot.

The purpose of this codebase-overhaul is to:
improve the codebase organization
unlink the operation of the web application from telegram, so that it works on telegram, discord, and a web interface, by using the internal and external api
improve the business logic
Generate REVENUE



in my mind, that looks like this, spoken loosely:

We have:

-services:
    -comfyuideploy
    -vidu
    -tripo
    -11labs

services consist of api endpoints for their respective tools, prices/costs. we set restrictions based on prices/costs and allow users to access the tools if they can interact with the business logic and succeed

(telegram discord)
-commands:
    -general stationthisbot commands
    -tool commands
    
web interface:
    -canvas

instead of typing a /command into a telegram chat to interact with our tools, the user clicks them from a menu, where the default values are visible and they request like that, as long as their account agrees with our business logic.

