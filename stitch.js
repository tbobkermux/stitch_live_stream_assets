// Require express and body-parser

const express = require("express");
const bodyParser = require("body-parser");
const http = require('http');
const { Server } = require("socket.io");
const { parse } = require("path");


const Mux = require('@mux/mux-node');
const dotenv = require('dotenv');
dotenv.config();

const livereload = require("livereload");
const connectLiveReload = require("connect-livereload");
const { AssertionError } = require("assert");

const liveReloadServer = livereload.createServer();
liveReloadServer.server.once("connection", () => {
  setTimeout(() => {
    liveReloadServer.refresh("/");
  }, 100);
});


const app = express()
const server = http.createServer(app);
app.use(bodyParser.json())
app.use(connectLiveReload());
server.listen(5005, () => console.log(`Server running on port 5005`))

const io = new Server(server);
const muxClient = new Mux();
const { Video } = muxClient;

// load the client side html file
app.get("/", (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.use("/", express.static(__dirname))


// set or get status of master access
const masterAccess =  async (assetid) => {
  try{
      const asset =  await Video.Assets.get(assetid);
      if(asset.master_access == "none"){
         await Video.Assets.updateMasterAccess(assetid, {master_access: "temporary"});
         return false
      } else if(asset.master_access == 'preparing'){
          return false; 
      } else if(asset.master_access == 'temporary' && asset.master.url != undefined){
        return asset.master.url;
      }
  } catch(e){
      console.log(`Asset: ${assetid}, Error: ${e}`);
  }
}

// fetch a live stream
async function liveStream(livestreamid){
  return await Video.LiveStreams.get(livestreamid).then(
    (result) => {
      return (result);
    },
    (error) => {
      return (error.messages[0]);
    }
  );
}

// get all asset ids from live stream
async function getLiveStreamAssets(live_stream_id){
  const getLiveStream = await liveStream(live_stream_id);
  return getLiveStream.recent_asset_ids;
}


// Initiate the stitching process
app.post("/stitch", async (req, res) => {
    const live_stream_id = req.body.live_stream_id;
    const canStitchAssets = await tryToProcessAssetStitching(live_stream_id);
    console.log(canStitchAssets);
    io.sockets.emit("rawwebhook", canStitchAssets.toString());
    res.status(200).end();
});

function writeMasterFilesToDiskAndStitch(masterAssetUrlsArray){
  return new Promise( resolve => {

      let writeToFile = "";
      masterAssetUrlsArray.forEach((item) =>{
        // write to a file
        writeToFile += `file '${item}'\n`;
      });
      console.log(writeToFile);
    
      const fs = require('fs');
    
      fs.truncate('masteraccess.txt', 0, function(){console.log('cleared file')})
      
      fs.appendFile('masteraccess.txt', writeToFile, (err) => {
          if (err) return console.error(err);
          console.log("File successfully written !");
      });
      // once done call a bash script to invoke ffmpeg
      const spawn = require('child_process').spawn
    
      var shellSyntaxCommand = `./merge.sh`;
      io.sockets.emit("rawwebhook", "Starting to merge files....");
      const child = spawn('sh', ['-c', shellSyntaxCommand], { stdio: 'pipe' });
      child.stdout.on('data', (data) => {
        resolve(`${data.toString()}`);
      });

    });
}


async function tryToProcessAssetStitching(live_stream_id){

    const live_stream_asset_ids = await getLiveStreamAssets(live_stream_id);

    let storeMasterAccessFiles = [];

    for(let x=0;x<live_stream_asset_ids.length;x++){
        let assetStatus = await masterAccess(live_stream_asset_ids[x]);
        if(!assetStatus){
            break;
        } else {
            storeMasterAccessFiles.push(assetStatus);
        }
    }

    if(storeMasterAccessFiles.length == live_stream_asset_ids.length){
        const start = await writeMasterFilesToDiskAndStitch(storeMasterAccessFiles);
        io.sockets.emit("rawwebhook", start);
        const uploadToMux = await uploadNewAsset();
        io.sockets.emit("rawwebhook", uploadToMux);
        return storeMasterAccessFiles;
    } else {
      return `${storeMasterAccessFiles.length} of ${live_stream_asset_ids.length} master files completed`;
    }
}

// route to accept the webhook
app.post("/webhooks", async (req, res) => {
  
    if(req.body.type == "video.asset.master.ready"){
        const live_stream_id = req.body.data.live_stream_id;
        const status = await tryToProcessAssetStitching(live_stream_id);
        io.sockets.emit("rawwebhook", status.toString());
    }

    if(req.body.type == "video.upload.asset_created"){
      io.sockets.emit("rawwebhook", "New asset uploaded");
    }
    if(req.body.type == "video.asset.ready"){
      const playback_id = req.body.data.playback_ids[0].id;
      io.sockets.emit("rawwebhook", "New asset uploaded");
      io.sockets.emit("rawwebhook", `https://stream.mux.com/${playback_id}.m3u8`)
    }
    res.status(200).end();
  })


// reset the master access for asset in livestream 
app.get("/reset-master-access", async (req, res) => {

  const getLiveStream = await liveStream(req.query.livestreamid);
  // get recent assets
  const recent_assets = getLiveStream.recent_asset_ids;

  recent_assets.map( async (asset) => {
    await Video.Assets.updateMasterAccess(asset, {master_access: "none"});
  })
  res.status(200).end();
})

const uploadNewAsset = () => {
  
  return new Promise( async resolve => {

    const fs = require('fs');
    const request = require('request');
    const axios = require('axios');
    const FormData = require('form-data'); 

    const form = new FormData();
    const uploadURL = await getUploadUrl();

    form.append('file', fs.createReadStream("./mergedmasterfile.mp4"), 'mergedmasterfile.mp4');

    axios.post(uploadURL.url.toString(), form, {
      headers: {
        ...form.getHeaders()
      }
    }).then( r => {
        resolve(`merged master access files uploaded to Mux - Upload ID: ${uploadUrl.id}`);
    });
  })

}

const getUploadUrl = () => {
  return new Promise( async resolve => {
    const upload = await Video.Uploads.create({
      cors_origin: '*',
      new_asset_settings: {
        playback_policy: 'public',
      },
  });
  resolve(upload);
  })
}




