import pandas as pd
import shutil
import os

# Read the CSV file
csv_path = 'output3.csv'
df = pd.read_csv(csv_path)

# Set the path of the source folder and destination folder
source_folder = 'md/'
dest_folder = 'extracted_md_files/'

# Check if destination folder exists, if not create it
if not os.path.exists(dest_folder):
    os.makedirs(dest_folder)

# Iterate through each row of the dataframe
for index, row in df.iterrows():
    # Construct file name pattern and search in source_folder
    file_pattern = f"{row['XID']}-markdown.md"
    
    for file_name in os.listdir(source_folder):
        # If file_name matches pattern, copy it to dest_folder
        if file_name == file_pattern:
            shutil.copy(os.path.join(source_folder, file_name),
                        os.path.join(dest_folder, file_name))
