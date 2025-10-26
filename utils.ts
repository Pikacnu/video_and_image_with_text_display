export const commandTemplate =
  'summon minecraft:text_display ~@posX@ ~@posY@ ~ {Tags:["video_frame"],text:[@text@],background: @bgColor@ ,width:20000,line_width:@lineWidth@}';
export const dataMergeCommandTemplate =
  'execute as @e[type=minecraft:text_display,tag=video_frame,tag=@tag@] run data modify entity @s text set value [@text@]';
export const bgColorUpdateCommandTemplate =
  'execute as @e[type=minecraft:text_display,tag=video_frame,tag=@tag@] run data modify entity @s background set value @bgColor@';
export const chunkTemplate = '{text:"@text@",color:"@color@"},';
export const bigChunkTemplate = '{text:"",color:"@color@",extra:[@inner@]},';
export const chunkEntryTemplate = '{text:"@text@"@color@},';
export const lineHeight = 0.2;
export const blockLeading = 0.025;
export const withPaddingLineHeight = 0.25;
export const widthNeededPerBlock = 9;
