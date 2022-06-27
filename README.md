# Merge all the auto created live stream recordedings
If you ever had multiple asssets generated from the live stream, this will merge them all into a single mp4 and upload it to Mux.  

## Requirements 
Run ```yarn install``` or ```npm install```
This installs npm packages required to run the examples.

rename the ```.env_example``` file to ```.env``` and populate the environment variables with your API key and secret and chosen subdomain that will be used for the fixed webhook url.

You need to have ffmpeg installed in your local environment as it used this to merge all the assets together. 

## Run the example
Now run ```yarn stitch``` in the terminal to start the process.
