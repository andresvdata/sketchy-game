/*
 * Sketchy prompt deck.
 *
 * This is the easiest place to contribute! Each key is a category name shown
 * to players, and each value is a list of drawing prompts.
 *
 * Rules for prompts (checked by `npm test`):
 *   - Start lowercase (the game capitalizes for display), no trailing punctuation.
 *   - 4 to 55 characters, drawable, and funny without being mean.
 *   - No real people, brands, or copyrighted characters.
 *   - No duplicates anywhere in the deck.
 *   - Each category needs at least 12 prompts so a full game never runs dry.
 *   - Keep it family friendly: people play this with friends, kids and coworkers.
 */
(function (root) {
  const PROMPTS = {
  "Animals":["a giraffe stuck in an elevator","a penguin on vacation","a cat running a business meeting","a dog who just got caught","a raccoon at a fancy dinner","a shark afraid of water","an octopus doing chores","a sloth in a hurry","a bear at a job interview","a goldfish with big dreams","a chicken crossing a very busy road","a moose at the car wash","a snail winning a race","a hamster's workout routine","an owl who stayed up too late","a cow on a trampoline","a frog on a first date","a squirrel planning a heist","a horse learning to drive","a pigeon stealing a sandwich"],
  "Food":["a pizza with feelings","a nervous lasagna","a burrito wedding","a banana slipping on a person","broccoli at the gym","the last fry in the bag","a sushi roll on a rollercoaster","a haunted cupcake","a toaster's worst day","a taco falling apart","a sandwich that's way too tall","spaghetti in a hurricane","a donut doing yoga","an angry hot sauce","a pancake tower","a watermelon at the beach","popcorn panic","a cheese lover's dream","a vegetable rebellion","soup that's way too hot"],
  "Jobs":["a nervous astronaut","a dentist on a bad day","a firefighter rescuing a cat","a chef with too many orders","a pirate accountant","a lifeguard who can't swim","a robot barista","a plumber in space","a superhero doing paperwork","a mime at a job interview","a zookeeper chasing a monkey","a pilot with a paper airplane","a teacher on the last day of school","a magician whose trick went wrong","a detective who lost their glasses","a mail carrier versus a dog","a farmer with a giant vegetable","a weather reporter in a storm","a construction worker on lunch break","a lumberjack with a tiny axe"],
  "Sports":["a sumo wrestler in ballet class","a hockey fight in slow motion","a goalie who is way too big","a marathon runner who took a wrong turn","a basketball player on stilts","synchronized swimming cats","a surfer on a giant wave","a golfer who lost the ball","a skier going backwards","a bowling strike gone wrong","a referee getting yelled at","a curling team sweeping too hard","a weightlifter lifting a car","a skateboard trick fail","a wild goal celebration","a boxing kangaroo","a tennis ball with a headache","a bicycle built for ten","a gymnast in a tiny room","a fishing contest disaster"],
  "Places":["a haunted gas station","a library at midnight","an airport security line","a very crowded beach","a volcano in a backyard","a treehouse mansion","a laundromat for monsters","a castle in the suburbs","a lighthouse in the desert","a gym on the moon","a parking lot with one spot left","a dentist's waiting room","an underwater apartment","a supermarket on sale day","a campsite with a bear problem","a cozy cabin in a blizzard","a rollercoaster that's way too tall","the lost and found box","a hotel room facing a brick wall","a traffic jam of boats"],
  "Fantasy":["a dragon at the dentist","a wizard's messy kitchen","a unicorn traffic jam","a vampire at the beach","a ghost who is scared of people","a mermaid on dry land","a troll under a tiny bridge","a fairy with a leaf blower","a zombie's birthday party","a knight afraid of horses","a witch's broom in the repair shop","an alien's first pizza","a robot falling in love","a giant tiptoeing","a time traveler in the wrong year","a genie with a broken lamp","a werewolf getting a haircut","a phoenix in the rain","an elf on a coffee break","a monster afraid of the dark"],
  "Everyday chaos":["losing your phone while holding it","stepping on a toy brick","the Wi-Fi going down","a sneeze in a quiet room","forgetting someone's name","furniture with no instructions","a shopping cart with one bad wheel","waiting for the microwave","fighting over the last slice","a group photo where someone blinked","a Monday morning","an alarm clock that won't stop","a sock that lost its partner","a printer jam","an umbrella flipping inside out","running for the bus","a phone at 1% battery","a brain freeze","a spider in the shower","tangled headphones"],
  "Parties":["a birthday cake on fire","a snowman in summer","a turkey escaping","a pumpkin with stage fright","a reindeer on strike","a piñata fighting back","a party where nobody dances","fireworks gone wrong","a costume party disaster","an awkward slow dance","a gift too big for the door","a love letter from a robot","an egg hunt for dinosaurs","a New Year's resolution failing","karaoke night","a wedding cake falling over","a surprise party gone wrong","a backyard barbecue","a baby shower for a dinosaur","a graduation cap stuck in a tree"]
};

  if (typeof module !== 'undefined' && module.exports) module.exports = PROMPTS;
  else root.SKETCHY_PROMPTS = PROMPTS;
})(this);
