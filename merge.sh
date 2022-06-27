#!/bin/bash

ffmpeg -y -protocol_whitelist file,http,https,tcp,tls -f concat -safe 0 -i masteraccess.txt -c copy mergedmasterfile.mp4

printf "All master access file have been Merged into http://localhost:5005/mergedmasterfile.mp4"

