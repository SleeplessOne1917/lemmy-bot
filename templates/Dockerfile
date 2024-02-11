FROM node:lts-alpine

WORKDIR # Put workdir here

COPY package*.json ./

RUN npm install

COPY . .

# This command assumes there's a script defined in package.json to run the bot
CMD [ "npm", "run", "start" ]
