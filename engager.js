const got = require('got')
require('dotenv').config()

let token = 'YOUR TOKEN GOES HERE'
let instanceID = getAllUrlParams().id
let selectedValue = getAllUrlParams().selectedValue

// create custom reward from provided developer info
var xmlhttp = new XMLHttpRequest();
xmlhttp.onreadystatechange = function() {
  if (this.readyState == 4 && this.status == 200) {
    var rewardArr = JSON.parse(this.responseText)
  }
};
xmlhttp.open("GET", "get_rewards.php?id=" + instanceID, true)
xmlhttp.send()

const customRewardBody = {
    title: rewardArr[0],
    prompt: rewardArr[1],
    cost: rewardArr[2],
    is_enabled:true,
    is_global_cooldown_enabled:true,
    global_cooldown_seconds:10 * 60,
}

let clientId = ""
let userId = ""
let headers = {}
let rewardId = ""
let pollingInterval

// validates the provided token and validates the token has the correct scope(s). additionally, uses the response to pull the correct client_id and broadcaster_id
const validateToken = async () => {
    let r
    try {
        let {body} = await got(`https://id.twitch.tv/oauth2/validate`, {
            headers:{
                "Authorization": `Bearer ${token}`
            }
        })
        r = JSON.parse(body)
    } catch (error) {
        console.log('Invalid token. Please get a new token using twitch token -u -s "channel:manage:redemptions user:edit:follows"')
        return false
    }

    if(r.scopes.indexOf("channel:manage:redemptions") == -1 || r.scopes.indexOf("user:edit:follows") == -1){
        console.log('Invalid scopes. Please get a new token using twitch token -u -s "channel:manage:redemptions user:edit:follows"')
        return false
    }

    // update the global variables to returned values
    clientId = r.client_id
    userId = r.user_id
    headers = {
        "Authorization": `Bearer ${token}`,
        "Client-ID": clientId,
        "Content-Type": "application/json"
    }

    return true
}

// returns an object containing the custom rewards, or if an error, null
const getCustomRewards = async () => {
    try {
        let {body} = await got(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${userId}`,{headers:headers})
        return JSON.parse(body).data
    } catch (error) {
        console.log(error)
        return null
    }
}

// if the custom reward doesn't exist, creates it. returns true if successful, false if not
const addCustomReward = async () => {
    try {
        let {body} = await got.post(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${userId}`, {
            headers: headers,
            body: JSON.stringify(customRewardBody),
            responseType: 'json',
        })

        rewardId = body.data[0].id
        return true
    } catch (error) {
        console.log("Failed to add the reward. Please try again.")
        return false
    }
}

// function for polling every 15 seconds to check for user redemptions
const pollForRedemptions = async () => {
    try {
        let {body} = await got(`https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?broadcaster_id=${userId}&reward_id=${rewardId}&status=UNFULFILLED`, {
            headers: headers,
            responseType: 'json',
        })

        let redemptions = body.data
        let successfulRedemptions = []
        let failedRedemptions = []

        for (let redemption of redemptions){

            // change property but if failed, add to the failed redemptions
            if(await changeProperty() == false){
                failedRedemptions.push(redemption.id)
                continue
            }
            // otherwise, add to the successful redemption list
            successfulRedemptions.push(redemption.id)
        }

        // do this in parallel
        await Promise.all([
            fulfillRewards(successfulRedemptions,"FULFILLED"),
            fulfillRewards(failedRedemptions,"CANCELED")
        ])

        console.log(`Processed ${successfulRedemptions.length + failedRedemptions.length} redemptions.`)

        // instead of an interval, we wait 15 seconds between completion and the next call
        pollingInterval = setTimeout(pollForRedemptions, 15 * 1000)
    } catch (error) {
        console.log("Unable to fetch redemptions.")
    }
}

// changes the property for redeeming points
const changeProperty = async () => {
    try {
        await got.post(`update_property.php?id=${instanceID}&value=${selectedValue}`, {headers: headers})
        return true
    } catch (error) {
        console.log(`Unable to change the property.`)
        return false
    }
}

const fulfillRewards = async (ids, status) => {
    // if empty, just cancel
    if(ids.length == 0 ){
        return
    }

    // transforms the list of ids to ids=id for the API call
    ids = ids.map(v=>`id=${v}`)

    try {
        await got.patch(`https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?broadcaster_id=${userId}&reward_id=${rewardId}&${ids.join("&")}`, {
            headers,
            json:{
                status: status
            }
        })
    } catch (error) {
        console.log(error)
    }
}

// get URL params
function getAllUrlParams(url) {

  var queryString = url ? url.split('?')[1] : window.location.search.slice(1)
  var obj = {}
  if (queryString) {

    queryString = queryString.split('#')[0]

    var arr = queryString.split('&')

    for (var i = 0; i < arr.length; i++) {
      var a = arr[i].split('=')

      var paramName = a[0]
      var paramValue = typeof (a[1]) === 'undefined' ? true : a[1]

      paramName = paramName.toLowerCase()
      if (typeof paramValue === 'string') paramValue = paramValue.toLowerCase()

      if (paramName.match(/\[(\d+)?\]$/)) {

        var key = paramName.replace(/\[(\d+)?\]/, '')
        if (!obj[key]) obj[key] = []

        if (paramName.match(/\[\d+\]$/)) {
          var index = /\[(\d+)\]/.exec(paramName)[1]
          obj[key][index] = paramValue
        } else {
          obj[key].push(paramValue)
        }
      } else {
        if (!obj[paramName]) {
          obj[paramName] = paramValue
        } else if (obj[paramName] && typeof obj[paramName] === 'string'){
          obj[paramName] = [obj[paramName]]
          obj[paramName].push(paramValue)
        } else {
          obj[paramName].push(paramValue)
        }
      }
    }
  }
  return obj
}

// main function - sets up the reward and sets the interval for polling
const main = async () => {
    if(await validateToken() == false){
        return
    }

    let rewards = await getCustomRewards()

    rewards.forEach(v=>{
        // since the title is enforced as unique, it will be a good identifier to use to get the right ID on cold-boot
        if (v.title == customRewardBody.title){
            rewardId = v.id
        }
    })

    // if the reward isn't set up, add it
    if(rewardId == "" && await addCustomReward() == false){
        return
    }

    pollForRedemptions()
}

// start the script
main()
